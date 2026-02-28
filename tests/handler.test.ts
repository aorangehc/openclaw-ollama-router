import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateModel, PluginConfig } from '../src/types/index.js';

const { mockClient, chooseModelMock, detectTaskTypeMock } = vi.hoisted(() => ({
  mockClient: {
    listModels: vi.fn(),
    listRunning: vi.fn(),
    getModelCapabilities: vi.fn(),
    chat: vi.fn(),
    generateImage: vi.fn(),
  },
  chooseModelMock: vi.fn(),
  detectTaskTypeMock: vi.fn(),
}));

vi.mock('../src/ollama/client.js', () => ({
  createClient: vi.fn(() => mockClient),
}));

vi.mock('../src/router/chooseModel.js', () => ({
  chooseModel: chooseModelMock,
  detectTaskType: detectTaskTypeMock,
}));

import { handleOmniRoute, handleOllamaRoute } from '../src/handler.js';

const config: PluginConfig = {
  baseUrl: 'http://127.0.0.1:11434',
};

function makeCandidate(overrides: Partial<CandidateModel> = {}): CandidateModel {
  return {
    name: 'qwen2.5:7b',
    size: 4_000_000_000,
    hasVision: false,
    hasImageGeneration: false,
    parameterSize: '7B',
    quantizationLevel: 'Q4_0',
    isRunning: false,
    ...overrides,
  };
}

describe('Handler Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    detectTaskTypeMock.mockImplementation((text?: string, images?: string[]) => (
      images && images.length > 0 ? 'vision' : (text?.includes('draw') ? 'image_generation' : 'chat')
    ));

    mockClient.listModels.mockResolvedValue({
      models: [
        { name: 'qwen2.5:7b', modified_at: '2025-01-01', size: 4_000_000_000, digest: 'sha256:qwen' },
      ],
    });
    mockClient.listRunning.mockResolvedValue({ models: [] });
    mockClient.getModelCapabilities.mockResolvedValue({
      hasVision: false,
      hasImageGeneration: false,
      parameterSize: '7B',
      quantizationLevel: 'Q4_0',
    });
    mockClient.chat.mockResolvedValue({
      message: { role: 'assistant', content: 'Hello from omni router' },
    });
    mockClient.generateImage.mockResolvedValue({ b64_json: 'base64-image' });
    chooseModelMock.mockReturnValue([makeCandidate()]);
  });

  it('exports both omni and legacy handler names', () => {
    expect(handleOmniRoute).toBe(handleOllamaRoute);
  });

  it('routes a chat request and returns diagnostics', async () => {
    const response = await handleOmniRoute(
      { task: 'chat', text: 'Explain transformers' },
      config
    );

    expect(response.chosen_model).toBe('qwen2.5:7b');
    expect(response.text).toBe('Hello from omni router');
    expect(response.diagnostics.candidates_tried).toEqual(['qwen2.5:7b']);
    expect(response.diagnostics.audio).toEqual({
      hasAudio: false,
      transcript_used: false,
      channel: undefined,
    });
    expect(mockClient.chat).toHaveBeenCalledWith(
      'qwen2.5:7b',
      [{ role: 'user', content: 'Explain transformers' }],
      0
    );
  });

  it('routes image generation requests through generateImage', async () => {
    const candidate = makeCandidate({
      name: 'flux:latest',
      hasImageGeneration: true,
      parameterSize: '12B',
    });

    mockClient.listModels.mockResolvedValue({
      models: [
        { name: 'flux:latest', modified_at: '2025-01-01', size: 12_000_000_000, digest: 'sha256:flux' },
      ],
    });
    mockClient.getModelCapabilities.mockResolvedValue({
      hasVision: false,
      hasImageGeneration: true,
      parameterSize: '12B',
      quantizationLevel: 'Q4_0',
    });
    chooseModelMock.mockReturnValue([candidate]);

    const response = await handleOmniRoute(
      { task: 'image_generation', text: 'draw a neon city' },
      config
    );

    expect(response.chosen_model).toBe('flux:latest');
    expect(response.image_b64).toBe('base64-image');
    expect(mockClient.generateImage).toHaveBeenCalledWith('flux:latest', 'draw a neon city', 0);
  });

  it('returns a structured no-model response when the router finds no candidates', async () => {
    chooseModelMock.mockReturnValue([]);

    const response = await handleOmniRoute(
      { task: 'chat', text: 'Hello' },
      config
    );

    expect(response.chosen_model).toBe('');
    expect(response.text).toBeUndefined();
    expect(response.diagnostics.errors).toContainEqual({ message: 'No suitable models found' });
  });

  it('falls back to the next candidate when the first model fails', async () => {
    const first = makeCandidate({ name: 'qwen2.5:14b', parameterSize: '14B', size: 8_000_000_000 });
    const second = makeCandidate({ name: 'qwen2.5:7b' });

    mockClient.listModels.mockResolvedValue({
      models: [
        { name: first.name, modified_at: '2025-01-01', size: first.size, digest: 'sha256:first' },
        { name: second.name, modified_at: '2025-01-01', size: second.size, digest: 'sha256:second' },
      ],
    });
    mockClient.getModelCapabilities
      .mockResolvedValueOnce({
        hasVision: false,
        hasImageGeneration: false,
        parameterSize: '14B',
        quantizationLevel: 'Q4_0',
      })
      .mockResolvedValueOnce({
        hasVision: false,
        hasImageGeneration: false,
        parameterSize: '7B',
        quantizationLevel: 'Q4_0',
      });
    chooseModelMock.mockReturnValue([first, second]);
    mockClient.chat
      .mockRejectedValueOnce(new Error('OOM'))
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'Recovered with smaller model' } });

    const response = await handleOmniRoute(
      { task: 'chat', text: 'Summarize this document', max_retries: 2 },
      config
    );

    expect(response.chosen_model).toBe('qwen2.5:7b');
    expect(response.text).toBe('Recovered with smaller model');
    expect(response.diagnostics.candidates_tried).toEqual(['qwen2.5:14b', 'qwen2.5:7b']);
    expect(response.diagnostics.errors).toContainEqual({
      model: 'qwen2.5:14b',
      message: 'OOM',
      status: undefined,
    });
  });
});
