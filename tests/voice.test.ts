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

import { handleOmniRoute } from '../src/handler.js';

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

describe('Voice Input Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    detectTaskTypeMock.mockReturnValue('chat');
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
      message: { role: 'assistant', content: 'Voice request handled' },
    });
    chooseModelMock.mockReturnValue([makeCandidate()]);
    readHardwareSnapshotMock.mockResolvedValue({
      platform: 'linux',
      arch: 'x64',
      cpuCount: 16,
      totalMemory: 32_000_000_000,
      freeMemory: 16_000_000_000,
      availableMemoryRatio: 0.5,
      gpuCount: 0,
      gpus: [],
    });
  });

  it('prefers transcript content over direct text and records audio diagnostics', async () => {
    const response = await handleOmniRoute(
      {
        task: 'auto',
        text: 'stale fallback text',
        context: {
          hasAudio: true,
          transcript: 'Explain the latest build failure',
          channel: 'telegram',
        },
      },
      config
    );

    expect(detectTaskTypeMock).toHaveBeenCalledWith('Explain the latest build failure', undefined);
    expect(chooseModelMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        text: 'Explain the latest build failure',
      })
    );
    expect(mockClient.chat).toHaveBeenCalledWith(
      'qwen2.5:7b',
      [{ role: 'user', content: 'Explain the latest build failure' }],
      0
    );
    expect(response.diagnostics.audio).toEqual({
      hasAudio: true,
      transcript_used: true,
      transcript_len: 32,
      channel: 'telegram',
      note: 'Transcript from tools.media.audio',
    });
  });

  it('returns a prompt instead of routing when audio arrives without transcript or text', async () => {
    const response = await handleOmniRoute(
      {
        task: 'auto',
        context: {
          hasAudio: true,
          channel: 'feishu',
        },
      },
      config
    );

    expect(response.chosen_model).toBe('');
    expect(response.text).toContain("couldn't find a transcript");
    expect(response.diagnostics.audio).toEqual({
      hasAudio: true,
      transcript_used: false,
      channel: 'feishu',
      note: 'Audio input received without transcript',
    });
    expect(mockClient.listModels).not.toHaveBeenCalled();
  });

  it('uses provided text when audio metadata exists but transcript is missing', async () => {
    const response = await handleOmniRoute(
      {
        task: 'chat',
        text: 'Summarize this meeting',
        context: {
          hasAudio: true,
          channel: 'discord',
        },
      },
      config
    );

    expect(mockClient.chat).toHaveBeenCalledWith(
      'qwen2.5:7b',
      [{ role: 'user', content: 'Summarize this meeting' }],
      0
    );
    expect(response.diagnostics.audio).toEqual({
      hasAudio: true,
      transcript_used: false,
      channel: 'discord',
      note: 'Audio input present but transcript unavailable; used provided text',
    });
  });
});
