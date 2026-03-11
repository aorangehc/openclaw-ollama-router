import { Type } from '@sinclair/typebox';

import { handleOmniInspect, handleOmniRoute, handleOmniRun } from './dist/handler.js';

const sharedTask = Type.Union([
  Type.Literal('auto'),
  Type.Literal('chat'),
  Type.Literal('vision'),
  Type.Literal('image_generation'),
]);

const sharedContext = Type.Optional(
  Type.Object({
    hasAudio: Type.Optional(Type.Boolean()),
    transcript: Type.Optional(Type.String()),
    channel: Type.Optional(Type.String()),
  })
);

const sharedInputFields = {
  task: sharedTask,
  text: Type.Optional(Type.String({ description: 'Text prompt or conversation content' })),
  images_b64: Type.Optional(
    Type.Array(Type.String(), { description: 'Base64 encoded images for vision tasks' })
  ),
  image_paths: Type.Optional(
    Type.Array(Type.String(), { description: 'Absolute local image file paths for vision tasks, such as Telegram-downloaded attachments' })
  ),
  context: sharedContext,
};

const omniInspectParameters = Type.Object(
  {
    task: Type.Optional(sharedTask),
    text: Type.Optional(Type.String({ description: 'Text prompt or conversation content' })),
    images_b64: Type.Optional(
      Type.Array(Type.String(), { description: 'Base64 encoded images for vision tasks' })
    ),
    image_paths: Type.Optional(
      Type.Array(Type.String(), { description: 'Absolute local image file paths for vision tasks, such as Telegram-downloaded attachments' })
    ),
    preference: Type.Optional(
      Type.Union([Type.Literal('speed'), Type.Literal('quality')], {
        description: 'Recommendation preference for the suggested model list',
      })
    ),
    context: sharedContext,
  },
  { additionalProperties: false }
);

const omniRunParameters = Type.Object(
  {
    model: Type.String({ description: 'Exact Ollama model name to execute' }),
    ...sharedInputFields,
    preference: Type.Optional(
      Type.Union([Type.Literal('speed'), Type.Literal('quality')], {
        description: 'Recommendation preference used when enforcing the primary recommended model',
      })
    ),
    use_recommended_model: Type.Optional(
      Type.Boolean({
        description: 'Force execution of recommended_models[0] for this request, ignoring manual model selection',
      })
    ),
    allow_recommendation_override: Type.Optional(
      Type.Boolean({
        description: 'Allow overriding a previously enforced recommended_models[0] lock for the same request',
      })
    ),
    keep_alive: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Keep-alive duration in seconds' }),
        Type.String({ description: 'Keep-alive duration string, e.g. 2m' }),
      ])
    ),
  },
  { additionalProperties: false }
);

const omniRouteParameters = Type.Object(
  {
    ...sharedInputFields,
    preference: Type.Optional(
      Type.Union([Type.Literal('speed'), Type.Literal('quality')], {
        description: 'Model preference: speed or quality',
      })
    ),
    max_retries: Type.Optional(Type.Number({ description: 'Maximum number of fallback attempts' })),
    keep_alive: Type.Optional(
      Type.Union([
        Type.Number({ description: 'Keep-alive duration in seconds' }),
        Type.String({ description: 'Keep-alive duration string, e.g. 2m' }),
      ])
    ),
  },
  { additionalProperties: false }
);

function normalizePluginConfig(pluginConfig) {
  const raw = pluginConfig && typeof pluginConfig === 'object' ? pluginConfig : {};
  const allowedModels = Array.isArray(raw.allowedModels)
    ? raw.allowedModels.filter((value) => typeof value === 'string' && value.trim())
    : undefined;

  return {
    baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl.trim()
      ? raw.baseUrl.trim()
      : 'http://127.0.0.1:11434',
    allowedModels,
    defaultPreference: raw.defaultPreference === 'quality' ? 'quality' : 'speed',
    defaultKeepAlive: typeof raw.defaultKeepAlive === 'string' || typeof raw.defaultKeepAlive === 'number'
      ? raw.defaultKeepAlive
      : 0,
    requestTimeout: typeof raw.requestTimeout === 'number' ? raw.requestTimeout : 120000,
  };
}

function summarizeResponse(response) {
  if (!response.image_b64) {
    return response;
  }

  return {
    ...response,
    image_b64: `[base64 omitted, length=${response.image_b64.length}]`,
  };
}

export default function register(api) {
  api.registerTool(
    {
      name: 'omni_inspect',
      label: 'Omni Inspect',
      description:
        'Inspect local Ollama models, current running state, and hardware availability so the main model can decide what to run.',
      parameters: omniInspectParameters,
      async execute(_toolCallId, params) {
        const response = await handleOmniInspect(params, normalizePluginConfig(api.pluginConfig));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
          details: response,
        };
      },
    },
    { name: 'omni_inspect' }
  );

  api.registerTool(
    {
      name: 'omni_run',
      label: 'Omni Run',
      description:
        'Execute a specific Ollama model, or force the primary recommended model from omni_inspect and lock the request to that choice.',
      parameters: omniRunParameters,
      async execute(_toolCallId, params) {
        const response = await handleOmniRun(params, normalizePluginConfig(api.pluginConfig));
        const summarized = summarizeResponse(response);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summarized, null, 2),
            },
          ],
          details: response,
        };
      },
    },
    { name: 'omni_run' }
  );

  api.registerTool(
    {
      name: 'omni_route',
      label: 'Omni Route',
      description:
        'Compatibility tool that inspects local models, chooses one automatically, and executes it.',
      parameters: omniRouteParameters,
      async execute(_toolCallId, params) {
        const response = await handleOmniRoute(params, normalizePluginConfig(api.pluginConfig));
        const summarized = summarizeResponse(response);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summarized, null, 2),
            },
          ],
          details: response,
        };
      },
    },
    { name: 'omni_route' }
  );
}
