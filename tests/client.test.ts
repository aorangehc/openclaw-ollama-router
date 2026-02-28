// Unit tests for Ollama HTTP Client

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaClient } from '../src/ollama/client.js';
import type { PluginConfig } from '../src/types/index.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('OllamaClient', () => {
  let client: OllamaClient;
  const config: PluginConfig = {
    baseUrl: 'http://127.0.0.1:11434',
    requestTimeout: 5000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OllamaClient(config);
  });

  describe('listModels', () => {
    it('should return list of models', async () => {
      const mockResponse = {
        models: [
          { name: 'llama2:7b', modified_at: '2024-01-01', size: 1234567890, digest: 'sha256:abc' },
          { name: 'llava:7b', modified_at: '2024-01-02', size: 2345678901, digest: 'sha256:def' },
        ],
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await client.listModels();
      expect(result.models).toHaveLength(2);
      expect(result.models[0].name).toBe('llama2:7b');
    });

    it('should throw on HTTP error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Server error' }),
      } as Response);

      await expect(client.listModels()).rejects.toThrow('Server error');
    });
  });

  describe('showModel', () => {
    it('should return model info', async () => {
      const mockResponse = {
        model: 'llama2:7b',
        modified_at: '2024-01-01',
        size: 1234567890,
        digest: 'sha256:abc',
        details: {
          parent_model: '',
          format: 'gguf',
          family: 'llama',
          families: ['llama'],
          parameter_size: '7B',
          quantization_level: 'Q4_0',
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await client.showModel('llama2:7b');
      expect(result.details.parameter_size).toBe('7B');
    });
  });

  describe('listRunning', () => {
    it('should return running models', async () => {
      const mockResponse = {
        models: [
          { id: '1', model: 'llama2:7b', size: 4000000000, duration: 1000 },
        ],
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await client.listRunning();
      expect(result.models).toHaveLength(1);
      expect(result.models[0].model).toBe('llama2:7b');
    });

    it('should return empty list when no models running', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      } as Response);

      const result = await client.listRunning();
      expect(result.models).toHaveLength(0);
    });
  });

  describe('chat', () => {
    it('should send chat request and return response', async () => {
      const mockResponse = {
        message: {
          role: 'assistant',
          content: 'Hello!',
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await client.chat('llama2:7b', [
        { role: 'user', content: 'Hello' }
      ]);

      expect(result.message.content).toBe('Hello!');
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:11434/api/chat',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"stream":false'),
        })
      );
    });

    it('should respect keepAlive parameter', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: { role: 'assistant', content: '' } }),
      } as Response);

      await client.chat('llama2:7b', [], '2m');

      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:11434/api/chat',
        expect.objectContaining({
          body: expect.stringContaining('"keep_alive":"2m"'),
        })
      );
    });
  });

  describe('healthCheck', () => {
    it('should return true when Ollama is accessible', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      } as Response);

      const result = await client.healthCheck();
      expect(result).toBe(true);
    });

    it('should return false when Ollama is not accessible', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('getModelCapabilities', () => {
    it('should detect vision models by family', async () => {
      const mockResponse = {
        model: 'llava:7b',
        details: {
          family: 'llava',
          families: ['llava'],
          parameter_size: '7B',
          quantization_level: 'Q4_0',
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await client.getModelCapabilities('llava:7b');
      expect(result.hasVision).toBe(true);
    });

    it('should detect vision models by name', async () => {
      const mockResponse = {
        model: 'llama3-vision:8b',
        details: {
          family: 'llama',
          families: ['llama'],
          parameter_size: '8B',
          quantization_level: 'Q4_0',
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await client.getModelCapabilities('llama3-vision:8b');
      expect(result.hasVision).toBe(true);
    });

    it('should detect image generation models by name', async () => {
      const mockResponse = {
        model: 'flux:latest',
        details: {
          family: 'flux',
          families: ['flux'],
          parameter_size: '12B',
          quantization_level: 'Q4_0',
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await client.getModelCapabilities('flux:latest');
      expect(result.hasImageGeneration).toBe(true);
    });

    it('should return default capabilities on error', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const result = await client.getModelCapabilities('unknown');
      expect(result.hasVision).toBe(false);
      expect(result.parameterSize).toBe('unknown');
    });
  });

  describe('timeout handling', () => {
    it('should respect custom timeout', async () => {
      vi.mocked(fetch).mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      await expect(
        client.listModels()
      ).rejects.toThrow();
    });
  });

  describe('generateImage', () => {
    it('should extract base64 image data from the generate fallback response', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: () => Promise.resolve({ error: 'missing endpoint' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            response: 'data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==',
          }),
        } as Response);

      const result = await client.generateImage('flux:latest', 'draw a cat');
      expect(result).toEqual({ b64_json: 'ZmFrZS1pbWFnZS1ieXRlcw==' });
    });
  });
});
