import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateModel, PluginConfig } from '../src/types/index.js';

const { mockClient, chooseModelMock, detectTaskTypeMock, readHardwareSnapshotMock } = vi.hoisted(() => ({
  mockClient: {
    listModels: vi.fn(),
    listRunning: vi.fn(),
    getModelCapabilities: vi.fn(),
    inspectModel: vi.fn(),
    chat: vi.fn(),
    generateImage: vi.fn(),
  },
  chooseModelMock: vi.fn(),
  detectTaskTypeMock: vi.fn(),
  readHardwareSnapshotMock: vi.fn(),
}));

vi.mock('../src/ollama/client.js', () => ({
  createClient: vi.fn(() => mockClient),
}));

vi.mock('../src/router/chooseModel.js', () => ({
  chooseModel: chooseModelMock,
  detectTaskType: detectTaskTypeMock,
}));

vi.mock('../src/system/hardware.js', () => ({
  readHardwareSnapshot: readHardwareSnapshotMock,
}));

import { handleOmniInspect, handleOmniRoute, handleOmniRun, handleOllamaRoute } from '../src/handler.js';

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
    mockClient.inspectModel.mockResolvedValue({
      name: 'qwen2.5:7b',
      size: 4_000_000_000,
      family: 'qwen',
      families: ['qwen'],
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
    readHardwareSnapshotMock.mockResolvedValue({
      platform: 'linux',
      arch: 'x64',
      cpuCount: 16,
      totalMemory: 32_000_000_000,
      freeMemory: 16_000_000_000,
      availableMemoryRatio: 0.5,
      gpuCount: 1,
      gpus: [
        {
          name: 'RTX 4050',
          memoryTotalMiB: 6144,
          memoryFreeMiB: 5800,
          memoryUsedMiB: 344,
        },
      ],
    });
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
    mockClient.inspectModel.mockResolvedValue({
      name: 'flux:latest',
      size: 12_000_000_000,
      family: 'flux',
      families: ['flux'],
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

  it('preserves the model error when image generation fails', async () => {
    const candidate = makeCandidate({
      name: 'x/flux2-klein:4b',
      hasImageGeneration: true,
      parameterSize: '8B',
      size: 5_700_000_000,
    });

    mockClient.listModels.mockResolvedValue({
      models: [
        { name: candidate.name, modified_at: '2025-01-01', size: candidate.size, digest: 'sha256:flux-klein' },
      ],
    });
    mockClient.getModelCapabilities.mockResolvedValue({
      hasVision: false,
      hasImageGeneration: true,
      parameterSize: '8B',
      quantizationLevel: 'FP4',
    });
    mockClient.inspectModel.mockResolvedValue({
      name: candidate.name,
      size: candidate.size,
      family: 'flux',
      families: ['flux'],
      hasVision: false,
      hasImageGeneration: true,
      parameterSize: '8B',
      quantizationLevel: 'FP4',
    });
    chooseModelMock.mockReturnValue([candidate]);
    mockClient.generateImage.mockRejectedValue(new Error('mlx runner failed: model.norm.weight'));

    const response = await handleOmniRoute(
      { task: 'image_generation', text: 'draw a red square' },
      config
    );

    expect(response.chosen_model).toBe(candidate.name);
    expect(response.diagnostics.errors).toContainEqual({
      model: candidate.name,
      message: 'mlx runner failed: model.norm.weight',
      status: undefined,
    });
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
    mockClient.inspectModel
      .mockResolvedValueOnce({
        name: first.name,
        size: first.size,
        family: 'qwen',
        families: ['qwen'],
        hasVision: false,
        hasImageGeneration: false,
        parameterSize: '14B',
        quantizationLevel: 'Q4_0',
      })
      .mockResolvedValueOnce({
        name: second.name,
        size: second.size,
        family: 'qwen',
        families: ['qwen'],
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

  it('returns model inventory and recommendations for omni_inspect', async () => {
    const response = await handleOmniInspect(
      { task: 'chat', text: 'Summarize the release notes', preference: 'quality' },
      config
    );

    expect(response.task).toBe('chat');
    expect(response.summary.totalModels).toBe(1);
    expect(response.hardware.gpuCount).toBe(1);
    expect(response.models[0]).toMatchObject({
      name: 'qwen2.5:7b',
      allowed: true,
      supportsResolvedTask: true,
    });
    expect(response.recommended_models).toEqual(['qwen2.5:7b']);
    expect(chooseModelMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        task: 'chat',
        preference: 'quality',
      })
    );
  });

  it('runs the explicitly selected model via omni_run', async () => {
    const response = await handleOmniRun(
      {
        model: 'qwen2.5:7b',
        task: 'chat',
        text: 'Answer directly',
      },
      config
    );

    expect(response.chosen_model).toBe('qwen2.5:7b');
    expect(response.text).toBe('Hello from omni router');
    expect(response.diagnostics.candidates_tried).toEqual(['qwen2.5:7b']);
  });

  it('enforces recommended_models[0] in omni_run when requested', async () => {
    const recommended = makeCandidate({
      name: 'deepseek-ocr:latest',
      hasVision: true,
      parameterSize: '3B',
      size: 6_000_000_000,
    });
    const ignored = makeCandidate({
      name: 'qwen3-vl:2b',
      hasVision: true,
      parameterSize: '2B',
      size: 2_000_000_000,
    });

    mockClient.listModels.mockResolvedValue({
      models: [
        { name: recommended.name, modified_at: '2025-01-01', size: recommended.size, digest: 'sha256:ocr' },
        { name: ignored.name, modified_at: '2025-01-01', size: ignored.size, digest: 'sha256:qwen-vl' },
      ],
    });
    mockClient.inspectModel
      .mockResolvedValueOnce({
        name: recommended.name,
        size: recommended.size,
        family: 'deepseekocr',
        families: ['deepseekocr'],
        hasVision: true,
        hasImageGeneration: false,
        parameterSize: '3B',
        quantizationLevel: 'F16',
      })
      .mockResolvedValueOnce({
        name: ignored.name,
        size: ignored.size,
        family: 'qwen3vl',
        families: ['qwen3vl'],
        hasVision: true,
        hasImageGeneration: false,
        parameterSize: '2B',
        quantizationLevel: 'Q4_K_M',
      });
    chooseModelMock.mockReturnValue([recommended, ignored]);
    mockClient.chat.mockResolvedValue({
      message: { role: 'assistant', content: 'Vision result' },
    });

    const response = await handleOmniRun(
      {
        model: ignored.name,
        use_recommended_model: true,
        task: 'vision',
        text: 'Describe this image briefly.',
        images_b64: ['base64'],
      },
      config
    );

    expect(response.chosen_model).toBe(recommended.name);
    expect(response.text).toBe('Vision result');
    expect(response.diagnostics.candidates_tried).toEqual([recommended.name]);
    expect(response.diagnostics.fallback).toBe(`enforced recommended_models[0]=${recommended.name}`);
    expect(mockClient.chat).toHaveBeenCalledWith(
      recommended.name,
      [{
        role: 'user',
        content: 'Describe this image briefly.',
        images: ['base64'],
      }],
      0
    );
  });

  it('rejects follow-up runs that try to override a recommendation lock', async () => {
    const recommended = makeCandidate({
      name: 'qwen3-vl:2b',
      hasVision: true,
      parameterSize: '2B',
      size: 2_000_000_000,
    });
    const blocked = makeCandidate({
      name: 'deepseek-ocr:latest',
      hasVision: true,
      parameterSize: '3B',
      size: 6_000_000_000,
    });

    mockClient.listModels.mockResolvedValue({
      models: [
        { name: recommended.name, modified_at: '2025-01-01', size: recommended.size, digest: 'sha256:qwen-vl' },
        { name: blocked.name, modified_at: '2025-01-01', size: blocked.size, digest: 'sha256:ocr' },
      ],
    });
    mockClient.inspectModel
      .mockResolvedValueOnce({
        name: recommended.name,
        size: recommended.size,
        family: 'qwen3vl',
        families: ['qwen3vl'],
        hasVision: true,
        hasImageGeneration: false,
        parameterSize: '2B',
        quantizationLevel: 'Q4_K_M',
      })
      .mockResolvedValueOnce({
        name: blocked.name,
        size: blocked.size,
        family: 'deepseekocr',
        families: ['deepseekocr'],
        hasVision: true,
        hasImageGeneration: false,
        parameterSize: '3B',
        quantizationLevel: 'F16',
      });
    chooseModelMock.mockReturnValue([recommended, blocked]);

    await handleOmniRun(
      {
        model: recommended.name,
        use_recommended_model: true,
        task: 'vision',
        text: 'Describe this image briefly.',
        images_b64: ['base64'],
      },
      config
    );

    const response = await handleOmniRun(
      {
        model: blocked.name,
        task: 'vision',
        text: 'Describe this image briefly.',
        images_b64: ['base64'],
      },
      config
    );

    expect(response.chosen_model).toBe(blocked.name);
    expect(response.text).toBeUndefined();
    expect(response.diagnostics.errors).toContainEqual({
      model: blocked.name,
      message: `Model '${blocked.name}' is blocked for this request; recommended_models[0] is locked to '${recommended.name}'`,
    });
    expect(mockClient.chat).toHaveBeenCalledTimes(1);
  });

  it('rejects disallowed models in omni_run before execution', async () => {
    const response = await handleOmniRun(
      {
        model: 'llama3:8b',
        task: 'chat',
        text: 'Answer directly',
      },
      {
        ...config,
        allowedModels: ['qwen2.5:7b'],
      }
    );

    expect(response.chosen_model).toBe('llama3:8b');
    expect(response.text).toBeUndefined();
    expect(response.diagnostics.errors).toContainEqual({
      model: 'llama3:8b',
      message: "Model 'llama3:8b' is not allowed by plugin configuration",
    });
    expect(mockClient.chat).not.toHaveBeenCalled();
  });
});
