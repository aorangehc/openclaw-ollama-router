import { describe, expect, it, vi } from 'vitest';

const { handleOmniInspectMock, handleOmniRouteMock, handleOmniRunMock } = vi.hoisted(() => ({
  handleOmniInspectMock: vi.fn(),
  handleOmniRouteMock: vi.fn(),
  handleOmniRunMock: vi.fn(),
}));

vi.mock('../dist/handler.js', () => ({
  handleOmniInspect: handleOmniInspectMock,
  handleOmniRoute: handleOmniRouteMock,
  handleOmniRun: handleOmniRunMock,
}));

import register from '../openclaw.extension.js';

describe('OpenClaw extension entry', () => {
  it('registers inspect, run, and route tools with normalized config', async () => {
    handleOmniInspectMock.mockResolvedValue({
      task: 'chat',
      summary: {
        totalModels: 1,
        allowedModels: 1,
        runningModels: 0,
        recommendedModels: 1,
      },
      hardware: {
        platform: 'linux',
        arch: 'x64',
        cpuCount: 8,
        totalMemory: 1,
        freeMemory: 1,
        availableMemoryRatio: 1,
        gpuCount: 0,
        gpus: [],
      },
      models: [],
      recommended_models: ['qwen3:4b-instruct'],
      diagnostics: {
        candidates_tried: [],
        audio: {
          hasAudio: false,
          transcript_used: false,
        },
      },
    });
    handleOmniRunMock.mockResolvedValue({
      chosen_model: 'qwen3:4b-instruct',
      task: 'chat',
      text: 'hello from ollama',
      diagnostics: {
        candidates_tried: ['qwen3:4b-instruct'],
        audio: {
          hasAudio: false,
          transcript_used: false,
        },
      },
    });
    handleOmniRouteMock.mockResolvedValue({
      chosen_model: 'qwen3:4b-instruct',
      task: 'chat',
      text: 'hello from ollama',
      diagnostics: {
        candidates_tried: ['qwen3:4b-instruct'],
        audio: {
          hasAudio: false,
          transcript_used: false,
        },
      },
    });

    const registerTool = vi.fn();

    register({
      pluginConfig: {
        baseUrl: 'http://127.0.0.1:11434',
        defaultPreference: 'quality',
        defaultKeepAlive: '2m',
        requestTimeout: 90_000,
        allowedModels: ['qwen3:4b-instruct', '', 123],
      },
      registerTool,
    } as never);

    expect(registerTool).toHaveBeenCalledTimes(3);

    const [inspectTool, inspectOptions] = registerTool.mock.calls[0];
    expect(inspectTool.name).toBe('omni_inspect');
    expect(inspectOptions).toEqual({ name: 'omni_inspect' });

    const [runTool, runOptions] = registerTool.mock.calls[1];
    expect(runTool.name).toBe('omni_run');
    expect(runOptions).toEqual({ name: 'omni_run' });

    const [routeTool, routeOptions] = registerTool.mock.calls[2];
    expect(routeTool.name).toBe('omni_route');
    expect(routeOptions).toEqual({ name: 'omni_route' });

    await inspectTool.execute('tool-call-inspect', {
      task: 'chat',
      text: 'hello',
    });
    expect(handleOmniInspectMock).toHaveBeenCalledWith(
      {
        task: 'chat',
        text: 'hello',
      },
      {
        baseUrl: 'http://127.0.0.1:11434',
        allowedModels: ['qwen3:4b-instruct'],
        defaultPreference: 'quality',
        defaultKeepAlive: '2m',
        requestTimeout: 90_000,
      }
    );

    await runTool.execute('tool-call-run', {
      model: 'qwen3:4b-instruct',
      use_recommended_model: true,
      task: 'chat',
      text: 'hello',
      image_paths: ['/tmp/example.png'],
    });
    expect(handleOmniRunMock).toHaveBeenCalledWith(
      {
        model: 'qwen3:4b-instruct',
        use_recommended_model: true,
        task: 'chat',
        text: 'hello',
        image_paths: ['/tmp/example.png'],
      },
      {
        baseUrl: 'http://127.0.0.1:11434',
        allowedModels: ['qwen3:4b-instruct'],
        defaultPreference: 'quality',
        defaultKeepAlive: '2m',
        requestTimeout: 90_000,
      }
    );

    const routeResult = await routeTool.execute('tool-call-route', {
      task: 'chat',
      text: 'hello',
    });
    expect(handleOmniRouteMock).toHaveBeenCalledWith(
      {
        task: 'chat',
        text: 'hello',
      },
      {
        baseUrl: 'http://127.0.0.1:11434',
        allowedModels: ['qwen3:4b-instruct'],
        defaultPreference: 'quality',
        defaultKeepAlive: '2m',
        requestTimeout: 90_000,
      }
    );

    expect(routeResult.details).toMatchObject({
      chosen_model: 'qwen3:4b-instruct',
      task: 'chat',
    });
  });

  it('summarizes image payloads in run and route tool content without dropping details', async () => {
    handleOmniRunMock.mockResolvedValue({
      chosen_model: 'flux:latest',
      task: 'image_generation',
      image_b64: 'ZmFrZS1pbWFnZQ==',
      diagnostics: {
        candidates_tried: ['flux:latest'],
        audio: {
          hasAudio: false,
          transcript_used: false,
        },
      },
    });
    handleOmniRouteMock.mockResolvedValue({
      chosen_model: 'flux:latest',
      task: 'image_generation',
      image_b64: 'ZmFrZS1pbWFnZQ==',
      diagnostics: {
        candidates_tried: ['flux:latest'],
        audio: {
          hasAudio: false,
          transcript_used: false,
        },
      },
    });

    const registerTool = vi.fn();
    register({ pluginConfig: {}, registerTool } as never);

    const [runTool] = registerTool.mock.calls[1];
    const [routeTool] = registerTool.mock.calls[2];

    const runResult = await runTool.execute('tool-call-run-2', {
      model: 'flux:latest',
      task: 'image_generation',
      text: 'draw a city',
    });
    expect(runResult.content[0].text).toContain('[base64 omitted');
    expect(runResult.details.image_b64).toBe('ZmFrZS1pbWFnZQ==');

    const routeResult = await routeTool.execute('tool-call-route-2', {
      task: 'image_generation',
      text: 'draw a city',
    });
    expect(routeResult.content[0].text).toContain('[base64 omitted');
    expect(routeResult.details.image_b64).toBe('ZmFrZS1pbWFnZQ==');
  });
});
