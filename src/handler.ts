// Tool Handler - Main entry point for omni_route tool

import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createClient } from './ollama/client.js';
import { chooseModel, detectTaskType } from './router/chooseModel.js';
import { readHardwareSnapshot } from './system/hardware.js';
import type {
  AudioDiagnostics,
  PluginConfig,
  ToolInput,
  OmniRouteResponse,
  CandidateModel,
  Diagnostics,
  InspectInput,
  InspectModel,
  OmniInspectResponse,
  RunInput,
  OmniRunResponse,
  TaskType,
  OllamaProcess,
} from './types/index.js';

const AUDIO_TRANSCRIPTION_HINT =
  '收到语音消息，但当前没有可用的转写结果。请在 OpenClaw 中启用 tools.media.audio 并配置 Ollama 语音转写，或直接发送文字。';
const RECOMMENDATION_LOCK_TTL_MS = 10 * 60 * 1000;
const recommendationLocks = new Map<string, { model: string; expiresAt: number }>();

function normalizeText(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeBase64Image(value?: string): string | undefined {
  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  const withoutDataUrl = normalized.replace(/^data:[^;]+;base64,/i, '');
  const withoutWhitespace = withoutDataUrl.replace(/\s+/g, '');
  const standardBase64 = withoutWhitespace
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  if (!standardBase64 || /[^A-Za-z0-9+/=]/.test(standardBase64)) {
    return undefined;
  }

  const paddingLength = (4 - (standardBase64.length % 4)) % 4;
  const padded = standardBase64 + '='.repeat(paddingLength);

  try {
    const decoded = Buffer.from(padded, 'base64');
    if (decoded.length === 0) {
      return undefined;
    }

    return decoded.toString('base64');
  } catch {
    return undefined;
  }
}

function normalizeImages(images_b64?: string[]): string[] | undefined {
  if (!images_b64 || images_b64.length === 0) {
    return undefined;
  }

  const normalized = images_b64
    .map(image => normalizeBase64Image(image))
    .filter((image): image is string => Boolean(image));

  return normalized.length > 0 ? normalized : undefined;
}

async function readImagesFromPaths(image_paths?: string[]): Promise<string[] | undefined> {
  if (!image_paths || image_paths.length === 0) {
    return undefined;
  }

  const images = await Promise.all(image_paths.map(async imagePath => {
    const normalizedPath = normalizeText(imagePath);
    if (!normalizedPath) {
      return undefined;
    }

    try {
      const fileBuffer = await readFile(normalizedPath);
      if (fileBuffer.length === 0) {
        return undefined;
      }

      return fileBuffer.toString('base64');
    } catch {
      return undefined;
    }
  }));

  const validImages = images.filter((image): image is string => Boolean(image));
  return validImages.length > 0 ? validImages : undefined;
}

async function resolveInputImages(input: {
  images_b64?: string[];
  image_paths?: string[];
}): Promise<string[] | undefined> {
  const [inlineImages, pathImages] = await Promise.all([
    Promise.resolve(normalizeImages(input.images_b64)),
    readImagesFromPaths(input.image_paths),
  ]);

  const merged = [
    ...(inlineImages || []),
    ...(pathImages || []),
  ];

  return merged.length > 0 ? merged : undefined;
}

async function prepareImagesForOllama(images_b64?: string[]): Promise<string[] | undefined> {
  const normalizedImages = normalizeImages(images_b64);
  if (!normalizedImages || normalizedImages.length === 0) {
    return undefined;
  }

  const prepared = await Promise.all(normalizedImages.map(async image => {
    try {
      const inputBuffer = Buffer.from(image, 'base64');
      if (inputBuffer.length === 0) {
        return image;
      }

      const metadata = await sharp(inputBuffer, { failOn: 'none' }).metadata();
      if (metadata.format === 'jpeg') {
        return image;
      }

      const outputBuffer = await sharp(inputBuffer, { failOn: 'none' })
        .jpeg({ quality: 92 })
        .toBuffer();

      return outputBuffer.toString('base64');
    } catch {
      return image;
    }
  }));

  return prepared.length > 0 ? prepared : undefined;
}

function buildAudioDiagnostics(input: ToolInput): AudioDiagnostics {
  const hasAudio = Boolean(input.context?.hasAudio);
  const transcript = normalizeText(input.context?.transcript);
  const directText = normalizeText(input.text);

  if (transcript) {
    return {
      hasAudio,
      transcript_used: true,
      transcript_len: transcript.length,
      channel: input.context?.channel,
      note: 'Transcript from tools.media.audio',
    };
  }

  if (hasAudio && directText) {
    return {
      hasAudio,
      transcript_used: false,
      channel: input.context?.channel,
      note: 'Audio input present but transcript unavailable; used provided text',
    };
  }

  if (hasAudio) {
    return {
      hasAudio,
      transcript_used: false,
      channel: input.context?.channel,
      note: 'Audio input received without transcript',
    };
  }

  return {
    hasAudio: false,
    transcript_used: false,
    channel: input.context?.channel,
  };
}

function createDiagnostics(input: { text?: string; context?: ToolInput['context'] }): Diagnostics {
  return {
    candidates_tried: [],
    audio: buildAudioDiagnostics({
      task: 'chat',
      text: input.text,
      context: input.context,
    }),
    errors: [],
    timings: {},
  };
}

function resolveTask(
  task: TaskType | undefined,
  text: string | undefined,
  images_b64: string[] | undefined
): TaskType {
  // If images are present, force vision task (unless explicitly requesting image generation)
  if (images_b64 && images_b64.length > 0 && task !== 'image_generation') {
    return 'vision';
  }

  if (!task || task === 'auto') {
    return detectTaskType(text, images_b64);
  }

  return task;
}

function buildRequestKey(task: TaskType, text?: string, images_b64?: string[]): string {
  return JSON.stringify({
    task,
    text: text || '',
    images_b64: images_b64 || [],
  });
}

function pruneRecommendationLocks(now: number): void {
  for (const [key, lock] of recommendationLocks.entries()) {
    if (lock.expiresAt <= now) {
      recommendationLocks.delete(key);
    }
  }
}

function isModelAllowed(name: string, allowedModels?: string[]): boolean {
  if (!allowedModels || allowedModels.length === 0) {
    return true;
  }

  const modelBase = name.split(':')[0];
  return allowedModels.some(allowed =>
    name === allowed ||
    name.startsWith(allowed) ||
    allowed === modelBase
  );
}

function isEmbeddingModel(name: string): boolean {
  const modelLower = name.toLowerCase();
  return modelLower.includes('embedding') ||
    modelLower.includes('embed') ||
    modelLower.includes('reranker') ||
    modelLower.includes('bge') ||
    modelLower.includes('bert');
}

function supportsResolvedTask(model: InspectModel, task: TaskType): boolean {
  if (task === 'vision') {
    return model.hasVision;
  }
  if (task === 'image_generation') {
    return model.hasImageGeneration;
  }
  return !model.embedding && !model.hasImageGeneration;
}

async function collectModelInventory(
  config: PluginConfig,
  task: TaskType
): Promise<{
  diagnostics: Diagnostics;
  models: InspectModel[];
  candidates: CandidateModel[];
  runningModels: OllamaProcess[];
}> {
  const startedAt = Date.now();
  const diagnostics = createDiagnostics({});
  const client = createClient({
    baseUrl: config.baseUrl || 'http://127.0.0.1:11434',
    requestTimeout: config.requestTimeout || 120000,
  });

  diagnostics.timings!.fetch_models_start = Date.now() - startedAt;

  const [tagsResponse, psResponse] = await Promise.all([
    client.listModels(),
    client.listRunning(),
  ]);

  diagnostics.timings!.fetch_models_end = Date.now() - startedAt;

  const runningModels = psResponse.models || [];
  const models: InspectModel[] = [];

  for (const model of tagsResponse.models) {
    const allowed = isModelAllowed(model.name, config.allowedModels);
    const embedding = isEmbeddingModel(model.name);
    const running = runningModels.find(process => process.model === model.name);

    try {
      const inspection = await client.inspectModel(model.name);
      models.push({
        name: model.name,
        modifiedAt: model.modified_at,
        digest: model.digest,
        size: model.size,
        hasVision: inspection.hasVision,
        hasImageGeneration: inspection.hasImageGeneration,
        parameterSize: inspection.parameterSize,
        quantizationLevel: inspection.quantizationLevel,
        isRunning: Boolean(running),
        runningSize: running?.size,
        allowed,
        embedding,
        supportsResolvedTask: false,
        family: inspection.family,
        families: inspection.families,
      });
    } catch (err) {
      const error = err as { message?: string };
      diagnostics.errors!.push({
        model: model.name,
        message: error.message || 'Failed to inspect model',
      });

      models.push({
        name: model.name,
        modifiedAt: model.modified_at,
        digest: model.digest,
        size: model.size,
        hasVision: false,
        hasImageGeneration: false,
        parameterSize: 'unknown',
        quantizationLevel: 'unknown',
        isRunning: Boolean(running),
        runningSize: running?.size,
        allowed,
        embedding,
        supportsResolvedTask: false,
        family: undefined,
        families: [],
      });
    }
  }

  for (const model of models) {
    model.supportsResolvedTask = supportsResolvedTask(model, task);
  }

  diagnostics.timings!.build_candidates = Date.now() - startedAt;

  const candidates = models
    .filter(model => model.allowed)
    .filter(model => task === 'image_generation' || !model.embedding)
    .map(model => ({
      name: model.name,
      size: model.size,
      hasVision: model.hasVision,
      hasImageGeneration: model.hasImageGeneration,
      parameterSize: model.parameterSize,
      quantizationLevel: model.quantizationLevel,
      isRunning: model.isRunning,
      runningSize: model.runningSize,
    }));

  return {
    diagnostics,
    models,
    candidates,
    runningModels,
  };
}

async function executeModelRequest(
  input: {
    model: string;
    task: TaskType;
    text?: string;
    images_b64?: string[];
    keep_alive?: number | string;
  },
  config: PluginConfig
): Promise<{ text?: string; image_b64?: string }> {
  const client = createClient({
    baseUrl: config.baseUrl || 'http://127.0.0.1:11434',
    requestTimeout: config.requestTimeout || 120000,
  });
  const normalizedImages = normalizeImages(input.images_b64);
  const preparedImages = await prepareImagesForOllama(input.images_b64);

  if (input.task === 'vision') {
    if (!normalizedImages || normalizedImages.length === 0 || !preparedImages || preparedImages.length === 0) {
      throw new Error('Vision task requires at least one valid base64 image');
    }

    const result = await client.chat(
      input.model,
      [{
        role: 'user',
        content: input.text || 'Describe this image',
        images: preparedImages,
      }],
      input.keep_alive ?? config.defaultKeepAlive ?? 0
    );

    return { text: result.message.content };
  }

  if (input.task === 'image_generation') {
    const result = await client.generateImage(
      input.model,
      input.text || 'Generate an image',
      input.keep_alive ?? config.defaultKeepAlive ?? 0
    );

    if (result.b64_json) {
      return { image_b64: result.b64_json };
    }

    throw new Error('Image generation endpoint returned no image payload');
  }

  const hasImages = preparedImages && preparedImages.length > 0;
  const messages = input.text
    ? [{ role: 'user', content: input.text, ...(hasImages ? { images: preparedImages } : {}) }]
    : [];
  const result = await client.chat(
    input.model,
    messages,
    input.keep_alive ?? config.defaultKeepAlive ?? 0
  );

  return { text: result.message.content };
}

async function resolveRecommendedModelName(
  input: {
    task: TaskType;
    text?: string;
    images_b64?: string[];
    preference?: 'speed' | 'quality';
  },
  config: PluginConfig
): Promise<string | undefined> {
  const [hardware, inventory] = await Promise.all([
    readHardwareSnapshot(),
    collectModelInventory(config, input.task),
  ]);

  const recommendedModels = chooseModel(inventory.candidates, {
    task: input.task,
    text: input.text,
    images_b64: input.images_b64,
    preference: input.preference ?? config.defaultPreference ?? 'speed',
    allowedModels: config.allowedModels,
    _runningProcesses: inventory.runningModels,
    _availableMemoryRatio: hardware.availableMemoryRatio,
  });

  return recommendedModels[0]?.name;
}

export async function handleOmniInspect(
  input: InspectInput,
  config: PluginConfig
): Promise<OmniInspectResponse> {
  const startTime = Date.now();
  const transcript = normalizeText(input.context?.transcript);
  const directText = normalizeText(input.text);
  const effectiveText = transcript ?? directText;
  const normalizedImages = await resolveInputImages(input);
  const task = resolveTask(input.task, effectiveText, normalizedImages);

  try {
    const [hardware, inventory] = await Promise.all([
      readHardwareSnapshot(),
      collectModelInventory(config, task),
    ]);

    const recommendationInput = {
      task,
      text: effectiveText,
      images_b64: normalizedImages,
      preference: input.preference ?? config.defaultPreference ?? 'speed',
      allowedModels: config.allowedModels,
      _runningProcesses: inventory.runningModels,
      _availableMemoryRatio: hardware.availableMemoryRatio,
    };

    const recommendedModels = chooseModel(inventory.candidates, recommendationInput)
      .map(model => model.name);

    inventory.diagnostics.timings = {
      ...(inventory.diagnostics.timings || {}),
      completed: Date.now() - startTime,
    };

    return {
      task,
      text: effectiveText,
      summary: {
        totalModels: inventory.models.length,
        allowedModels: inventory.models.filter(model => model.allowed).length,
        runningModels: inventory.models.filter(model => model.isRunning).length,
        recommendedModels: recommendedModels.length,
      },
      hardware,
      models: inventory.models,
      recommended_models: recommendedModels,
      diagnostics: inventory.diagnostics,
    };
  } catch (err) {
    const error = err as { message?: string };
    return {
      task,
      text: effectiveText,
      summary: {
        totalModels: 0,
        allowedModels: 0,
        runningModels: 0,
        recommendedModels: 0,
      },
      hardware: await readHardwareSnapshot(),
      models: [],
      recommended_models: [],
      diagnostics: {
        ...createDiagnostics(input),
        timings: {
          completed: Date.now() - startTime,
        },
        errors: [
          { message: error.message || 'Fatal error' },
        ],
      },
    };
  }
}

export async function handleOmniRun(
  input: RunInput,
  config: PluginConfig
): Promise<OmniRunResponse> {
  const startTime = Date.now();
  const transcript = normalizeText(input.context?.transcript);
  const directText = normalizeText(input.text);
  const effectiveText = transcript ?? directText;
  const normalizedImages = await resolveInputImages(input);
  const task = resolveTask(input.task, effectiveText, normalizedImages);
  const diagnostics = createDiagnostics(input);
  const now = Date.now();
  const requestKey = buildRequestKey(task, effectiveText, normalizedImages);

  pruneRecommendationLocks(now);

  if (diagnostics.audio.hasAudio && !effectiveText && (!normalizedImages || normalizedImages.length === 0)) {
    diagnostics.timings!.completed = Date.now() - startTime;
    return {
      chosen_model: '',
      task,
      text: AUDIO_TRANSCRIPTION_HINT,
      diagnostics,
    };
  }

  const requestedModel = input.model.trim();

  if (!requestedModel && !input.use_recommended_model) {
    diagnostics.timings!.completed = Date.now() - startTime;
    diagnostics.errors!.push({ message: 'Model name is required' });
    return {
      chosen_model: '',
      task,
      diagnostics,
    };
  }

  let selectedModel = requestedModel;

  if (input.use_recommended_model) {
    try {
      const recommendedModel = await resolveRecommendedModelName({
        task,
        text: effectiveText,
        images_b64: normalizedImages,
        preference: input.preference,
      }, config);

      if (!recommendedModel) {
        diagnostics.timings!.completed = Date.now() - startTime;
        diagnostics.errors!.push({ message: 'No suitable recommended model found' });
        return {
          chosen_model: requestedModel,
          task,
          diagnostics,
        };
      }

      selectedModel = recommendedModel;
      diagnostics.fallback = `enforced recommended_models[0]=${recommendedModel}`;
      recommendationLocks.set(requestKey, {
        model: recommendedModel,
        expiresAt: now + RECOMMENDATION_LOCK_TTL_MS,
      });
    } catch (err) {
      const error = err as { message?: string };
      diagnostics.timings!.completed = Date.now() - startTime;
      diagnostics.errors!.push({
        message: error.message || 'Failed to resolve recommended model',
      });
      return {
        chosen_model: requestedModel,
        task,
        diagnostics,
      };
    }
  } else {
    const lock = recommendationLocks.get(requestKey);
    if (lock && selectedModel !== lock.model && !input.allow_recommendation_override) {
      diagnostics.timings!.completed = Date.now() - startTime;
      diagnostics.errors!.push({
        model: selectedModel,
        message: `Model '${selectedModel}' is blocked for this request; recommended_models[0] is locked to '${lock.model}'`,
      });
      diagnostics.fallback = `recommendation lock=${lock.model}`;
      return {
        chosen_model: selectedModel,
        task,
        diagnostics,
      };
    }
  }

  if (!isModelAllowed(selectedModel, config.allowedModels)) {
    diagnostics.timings!.completed = Date.now() - startTime;
    diagnostics.errors!.push({
      model: selectedModel,
      message: `Model '${selectedModel}' is not allowed by plugin configuration`,
    });
    return {
      chosen_model: selectedModel,
      task,
      diagnostics,
    };
  }

  diagnostics.candidates_tried.push(selectedModel);

  try {
    const result = await executeModelRequest({
      model: selectedModel,
      task,
      text: effectiveText,
      images_b64: normalizedImages,
      keep_alive: input.keep_alive,
    }, config);

    diagnostics.timings!.completed = Date.now() - startTime;

    return {
      chosen_model: selectedModel,
      task,
      ...(result.text ? { text: result.text } : {}),
      ...(result.image_b64 ? { image_b64: result.image_b64 } : {}),
      diagnostics,
    };
  } catch (err) {
    const error = err as { message?: string; status?: number };
    diagnostics.timings!.completed = Date.now() - startTime;
    diagnostics.errors!.push({
      model: selectedModel,
      message: error.message || 'Unknown error',
      status: error.status,
    });

    return {
      chosen_model: selectedModel,
      task,
      diagnostics,
    };
  }
}

/**
 * Main handler for omni_route tool
 */
export async function handleOmniRoute(
  input: ToolInput,
  config: PluginConfig
): Promise<OmniRouteResponse> {
  const startTime = Date.now();
  const transcript = normalizeText(input.context?.transcript);
  const directText = normalizeText(input.text);
  const effectiveText = transcript ?? directText;
  const diagnostics = createDiagnostics(input);
  const normalizedImages = await resolveInputImages(input);
  const task = resolveTask(input.task, effectiveText, normalizedImages);

  // Get keepAlive value
  const keepAlive = input.keep_alive ?? config.defaultKeepAlive ?? 0;
  const maxRetries = input.max_retries ?? 3;
  const preference = input.preference ?? config.defaultPreference ?? 'speed';

  if (diagnostics.audio.hasAudio && !effectiveText && (!normalizedImages || normalizedImages.length === 0)) {
    diagnostics.timings!.completed = Date.now() - startTime;
    return {
      chosen_model: '',
      task,
      text: AUDIO_TRANSCRIPTION_HINT,
      diagnostics,
    };
  }

  try {
    const inventory = await collectModelInventory(config, task);
    diagnostics.errors = inventory.diagnostics.errors;
    diagnostics.timings = { ...(inventory.diagnostics.timings || {}) };

    // Choose best model
    const selectedModels = chooseModel(inventory.candidates, {
      task,
      text: effectiveText,
      images_b64: normalizedImages,
      preference,
      maxRetries,
      keepAlive,
      allowedModels: config.allowedModels,
      _runningProcesses: inventory.runningModels,
    });

    if (selectedModels.length === 0) {
      return {
        chosen_model: '',
        task,
        text: undefined,
        diagnostics: {
          ...diagnostics,
          errors: [...(diagnostics.errors || []), { message: 'No suitable models found' }],
        },
      };
    }

    // Try each candidate until one succeeds
    for (let attempt = 0; attempt < Math.min(selectedModels.length, maxRetries); attempt++) {
      const model = selectedModels[attempt];
      diagnostics.candidates_tried.push(model.name);

      const attemptStart = Date.now();

      try {
        const result = await executeModelRequest({
          model: model.name,
          task,
          text: effectiveText,
          images_b64: normalizedImages,
          keep_alive: keepAlive,
        }, config);

        diagnostics.timings![`attempt_${model.name}`] = Date.now() - attemptStart;
        diagnostics.timings!.completed = Date.now() - startTime;

        return {
          chosen_model: model.name,
          task,
          ...(result.text ? { text: result.text } : {}),
          ...(result.image_b64 ? { image_b64: result.image_b64 } : {}),
          diagnostics,
        };
      } catch (err) {
        const error = err as { message?: string; status?: number };
        diagnostics.errors = diagnostics.errors || [];
        diagnostics.errors.push({
          model: model.name,
          message: error.message || 'Unknown error',
          status: error.status,
        });

        // Try next model
        continue;
      }
    }

    // All candidates failed
    return {
      chosen_model: diagnostics.candidates_tried[diagnostics.candidates_tried.length - 1] || '',
      task,
      text: undefined,
      diagnostics: {
        ...diagnostics,
        timings: {
          ...(diagnostics.timings || {}),
          completed: Date.now() - startTime,
        },
        errors: [
          ...(diagnostics.errors || []),
          { message: 'All model attempts failed' },
        ],
      },
    };
  } catch (err) {
    const error = err as { message?: string };
    return {
      chosen_model: '',
      task,
      text: undefined,
      diagnostics: {
        ...diagnostics,
        timings: {
          ...(diagnostics.timings || {}),
          completed: Date.now() - startTime,
        },
        errors: [
          ...(diagnostics.errors || []),
          { message: error.message || 'Fatal error' },
        ],
      },
    };
  }
}

export const handleOllamaRoute = handleOmniRoute;
