// Ollama HTTP Client
// Handles all communication with Ollama API

import type {
  OllamaTagsResponse,
  OllamaShowResponse,
  OllamaPsResponse,
  PluginConfig,
  ApiError,
  ModelInspection,
} from '../types/index.js';

export class OllamaClient {
  private _baseUrl: string;
  private _timeout: number;

  constructor(config: PluginConfig) {
    this._baseUrl = config.baseUrl.replace(/\/$/, '');
    this._timeout = config.requestTimeout || 120000;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get timeout(): number {
    return this._timeout;
  }

  private inspectDetails(
    name: string,
    details: OllamaShowResponse['details']
  ): ModelInspection {
    const families = [details.family, ...(details.families || [])]
      .filter((value): value is string => Boolean(value))
      .map(value => value.toLowerCase());
    const lowerName = name.toLowerCase();

    const hasVision = families.some(family =>
      family.includes('llava') ||
      family.includes('vision') ||
      family.includes('qwen3vl') ||
      family.includes('deepseekocr')
    ) ||
      lowerName.includes('vision') ||
      lowerName.includes('llava') ||
      lowerName.includes('vl-') ||
      lowerName.includes('-vl');

    const imageGenerationHints = [
      'flux',
      'diffusion',
      'stable-diffusion',
      'stable_diffusion',
      'sdxl',
      'playground',
      'juggernaut',
    ];
    const hasImageGeneration = families.some(family =>
      imageGenerationHints.some(hint => family.includes(hint))
    ) || imageGenerationHints.some(hint => lowerName.includes(hint));

    return {
      name,
      size: 0,
      family: details.family || undefined,
      families,
      hasVision,
      hasImageGeneration,
      parameterSize: details.parameter_size || 'unknown',
      quantizationLevel: details.quantization_level || 'unknown',
    };
  }

  /**
   * Make an HTTP request with timeout and error handling
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    timeout?: number
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout || this._timeout);

    try {
      const response = await fetch(`${this._baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const error: ApiError = {
          status: response.status,
          message: `HTTP ${response.status}: ${response.statusText}`,
        };
        try {
          const body = await response.json() as { error?: unknown; message?: unknown };
          if (typeof body.error === 'string' && body.error) {
            error.message = body.error;
          } else if (body.error && typeof body.error === 'object' && 'message' in body.error) {
            const nestedMessage = (body.error as { message?: unknown }).message;
            if (typeof nestedMessage === 'string' && nestedMessage) {
              error.message = nestedMessage;
            } else {
              error.message = JSON.stringify(body.error);
            }
          } else if (typeof body.message === 'string' && body.message) {
            error.message = body.message;
          }
        } catch {
          // Ignore JSON parse errors
        }
        throw error;
      }

      return await response.json() as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw { message: 'Request timeout', code: 'TIMEOUT' } as ApiError;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * List all available models (GET /api/tags)
   */
  async listModels(): Promise<OllamaTagsResponse> {
    return this.request<OllamaTagsResponse>('/api/tags');
  }

  /**
   * Get detailed model information (POST /api/show)
   */
  async showModel(name: string): Promise<OllamaShowResponse> {
    return this.request<OllamaShowResponse>('/api/show', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  /**
   * List currently running models (GET /api/ps)
   */
  async listRunning(): Promise<OllamaPsResponse> {
    return this.request<OllamaPsResponse>('/api/ps');
  }

  /**
   * Get model capabilities by checking its info
   */
  async getModelCapabilities(name: string): Promise<{
    hasVision: boolean;
    hasImageGeneration: boolean;
    parameterSize: string;
    quantizationLevel: string;
  }> {
    try {
      const info = await this.showModel(name);
      const inspection = this.inspectDetails(name, info.details);

      return {
        hasVision: inspection.hasVision,
        hasImageGeneration: inspection.hasImageGeneration,
        parameterSize: inspection.parameterSize,
        quantizationLevel: inspection.quantizationLevel,
      };
    } catch {
      // Return default capabilities if show fails
      return {
        hasVision: false,
        hasImageGeneration: false,
        parameterSize: 'unknown',
        quantizationLevel: 'unknown',
      };
    }
  }

  async inspectModel(name: string): Promise<ModelInspection> {
    const info = await this.showModel(name);
    const inspection = this.inspectDetails(name, info.details);
    return {
      ...inspection,
      size: info.size,
    };
  }

  /**
   * Convert keepAlive to API format
   */
  private formatKeepAlive(keepAlive?: number | string): string {
    if (keepAlive === undefined || keepAlive === 0) {
      return '0';
    }
    if (typeof keepAlive === 'number') {
      return keepAlive.toString();
    }
    return keepAlive;
  }

  /**
   * Chat completion (POST /api/chat)
   */
  async chat(
    model: string,
    messages: Array<{ role: string; content: string; images?: string[] }>,
    keepAlive?: number | string
  ): Promise<{ message: { role: string; content: string } }> {
    return this.request<{ message: { role: string; content: string } }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        keep_alive: this.formatKeepAlive(keepAlive),
      }),
    });
  }

  /**
   * Generate completion (POST /api/generate)
   */
  async generate(
    model: string,
    prompt: string,
    keepAlive?: number | string
  ): Promise<{ response: string }> {
    return this.request<{ response: string }>('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        model,
        prompt,
        keep_alive: this.formatKeepAlive(keepAlive),
      }),
    });
  }

  /**
   * Check if Ollama is running and accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Try image generation via OpenAI compatibility endpoint
   * Note: Not all Ollama installations support this
   */
  async generateImage(
    model: string,
    prompt: string,
    keepAlive?: number | string
  ): Promise<{ b64_json?: string; url?: string }> {
    let lastError: unknown;

    // Try OpenAI compatibility endpoint first
    try {
      const result = await this.request<{
        b64_json?: string;
        url?: string;
        data?: Array<{ b64_json?: string; url?: string }>;
      }>('/v1/images/generations', {
        method: 'POST',
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size: '1024x1024',
        }),
      }, 30000); // Longer timeout for image generation
      const normalized = this.extractImageGenerationResult(result);
      if (normalized.b64_json || normalized.url) {
        return normalized;
      }
      throw new Error('Image generation endpoint returned no image data');
    } catch (error) {
      lastError = error;
      // Fallback: try direct Ollama endpoint if available
      try {
        const result = await this.request<{ b64_json?: string; url?: string; response?: string }>('/api/generate', {
          method: 'POST',
          body: JSON.stringify({
            model,
            prompt,
            keep_alive: this.formatKeepAlive(keepAlive),
          }),
        }, 30000);

        if (result.b64_json || result.url) {
          return result;
        }

        if (typeof result.response === 'string') {
          const normalized = result.response.trim();
          if (normalized.startsWith('data:image/')) {
            const [, base64 = ''] = normalized.split(',', 2);
            return base64 ? { b64_json: base64 } : {};
          }

          if (/^[A-Za-z0-9+/=\s]+$/.test(normalized) && normalized.length > 256) {
            return { b64_json: normalized.replace(/\s+/g, '') };
          }
        }

        throw new Error('Image generation endpoint returned no image data');
      } catch (fallbackError) {
        throw fallbackError ?? lastError ?? new Error('Image generation failed');
      }
    }
  }

  private extractImageGenerationResult(result: {
    b64_json?: string;
    url?: string;
    data?: Array<{ b64_json?: string; url?: string }>;
  }): { b64_json?: string; url?: string } {
    if (result.b64_json || result.url) {
      return {
        ...(result.b64_json ? { b64_json: result.b64_json } : {}),
        ...(result.url ? { url: result.url } : {}),
      };
    }

    const firstImage = result.data?.find(image => image.b64_json || image.url);
    if (firstImage) {
      return {
        ...(firstImage.b64_json ? { b64_json: firstImage.b64_json } : {}),
        ...(firstImage.url ? { url: firstImage.url } : {}),
      };
    }

    return {};
  }
}

export function createClient(config: PluginConfig): OllamaClient {
  return new OllamaClient(config);
}
