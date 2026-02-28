// Ollama HTTP Client
// Handles all communication with Ollama API

import type {
  OllamaTagsResponse,
  OllamaShowResponse,
  OllamaPsResponse,
  PluginConfig,
  ApiError,
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
          const body = await response.json() as { error?: string };
          if (body.error) {
            error.message = body.error;
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
      const details = info.details;
      const families = details.families || [];

      // Vision models typically have 'llava' family or vision in name
      // Also check for qwen3vl, deepseekocr (OCR/vision models)
      const hasVision = families.includes('llava') ||
        families.includes('vision') ||
        families.includes('qwen3vl') ||
        families.includes('deepseekocr') ||
        name.toLowerCase().includes('vision') ||
        name.toLowerCase().includes('llava') ||
        name.toLowerCase().includes('vl-') ||
        name.toLowerCase().includes('-vl');

      // Image generation - Ollama doesn't have native support,
      // but some models may support it via OpenAI compatibility
      const hasImageGeneration = false; // Will be determined by endpoint availability

      return {
        hasVision,
        hasImageGeneration,
        parameterSize: details.parameter_size || 'unknown',
        quantizationLevel: details.quantization_level || 'unknown',
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
    // Try OpenAI compatibility endpoint first
    try {
      return await this.request<{ b64_json?: string; url?: string }>('/v1/images/generations', {
        method: 'POST',
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size: '1024x1024',
        }),
      }, 30000); // Longer timeout for image generation
    } catch {
      // Fallback: try direct Ollama endpoint if available
      try {
        return await this.request<{ b64_json?: string; url?: string }>('/api/generate', {
          method: 'POST',
          body: JSON.stringify({
            model,
            prompt,
            keep_alive: this.formatKeepAlive(keepAlive),
          }),
        }, 30000);
      } catch {
        // Return empty result - caller should handle graceful degradation
        return {};
      }
    }
  }
}

export function createClient(config: PluginConfig): OllamaClient {
  return new OllamaClient(config);
}
