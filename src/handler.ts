// Tool Handler - Main entry point for ollama_route tool

import { createClient } from './ollama/client.js';
import { chooseModel, detectTaskType } from './router/chooseModel.js';
import type {
  PluginConfig,
  ToolInput,
  OllamaRouteResponse,
  CandidateModel,
  Diagnostics,
} from './types/index.js';

/**
 * Main handler for ollama_route tool
 */
export async function handleOllamaRoute(
  input: ToolInput,
  config: PluginConfig
): Promise<OllamaRouteResponse> {
  const startTime = Date.now();
  const diagnostics: Diagnostics = {
    candidates_tried: [],
    errors: [],
    timings: {},
  };

  // Create Ollama client
  const client = createClient({
    baseUrl: config.baseUrl || 'http://127.0.0.1:11434',
    requestTimeout: config.requestTimeout || 120000,
  });

  // Resolve task type
  const task = input.task === 'auto'
    ? detectTaskType(input.text, input.images_b64)
    : input.task;

  // Get keepAlive value
  const keepAlive = input.keep_alive ?? config.defaultKeepAlive ?? 0;
  const maxRetries = input.max_retries ?? 3;
  const preference = input.preference ?? config.defaultPreference ?? 'speed';

  try {
    diagnostics.timings!.fetch_models_start = Date.now() - startTime;

    // Fetch available models and running models in parallel
    const [tagsResponse, psResponse] = await Promise.all([
      client.listModels(),
      client.listRunning(),
    ]);

    diagnostics.timings!.fetch_models_end = Date.now() - startTime;

    // Build candidate models with capabilities
    const candidates: CandidateModel[] = [];

    for (const model of tagsResponse.models) {
      // Skip if not in allowed list
      if (config.allowedModels && config.allowedModels.length > 0) {
        const modelBase = model.name.split(':')[0];
        const isAllowed = config.allowedModels.some(allowed =>
          model.name === allowed ||
          model.name.startsWith(allowed) ||
          allowed === modelBase
        );
        if (!isAllowed) {
          continue;
        }
      }

      // Skip embedding/reranker models for chat/vision tasks
      const modelLower = model.name.toLowerCase();
      const isEmbedding = modelLower.includes('embedding') ||
        modelLower.includes('embed') ||
        modelLower.includes('reranker') ||
        modelLower.includes('bge') ||
        modelLower.includes('bert');
      if (isEmbedding && task !== 'image_generation') {
        continue;
      }

      // Get model capabilities
      const capabilities = await client.getModelCapabilities(model.name);

      candidates.push({
        name: model.name,
        size: model.size,
        hasVision: capabilities.hasVision,
        hasImageGeneration: capabilities.hasImageGeneration,
        parameterSize: capabilities.parameterSize,
        quantizationLevel: capabilities.quantizationLevel,
        isRunning: false, // Will be updated below
      });
    }

    // Mark running models
    const runningModels = psResponse.models || [];
    for (const candidate of candidates) {
      const running = runningModels.find(r => r.model === candidate.name);
      if (running) {
        candidate.isRunning = true;
        candidate.runningSize = running.size;
      }
    }

    diagnostics.timings!.build_candidates = Date.now() - startTime;

    // Choose best model
    const selectedModels = chooseModel(candidates, {
      task,
      text: input.text,
      images_b64: input.images_b64,
      preference,
      maxRetries,
      keepAlive,
      allowedModels: config.allowedModels,
      _runningProcesses: runningModels,
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
        let result;

        if (task === 'vision') {
          // Vision request
          result = await client.chat(
            model.name,
            [{
              role: 'user',
              content: input.text || 'Describe this image',
              images: input.images_b64,
            }],
            keepAlive
          );
          diagnostics.timings![`attempt_${model.name}`] = Date.now() - attemptStart;

          return {
            chosen_model: model.name,
            task,
            text: result.message.content,
            diagnostics,
          };
        } else if (task === 'image_generation') {
          // Image generation request
          const imgResult = await client.generateImage(
            model.name,
            input.text || 'Generate an image',
            keepAlive
          );

          diagnostics.timings![`attempt_${model.name}`] = Date.now() - attemptStart;

          if (imgResult.b64_json) {
            return {
              chosen_model: model.name,
              task,
              image_b64: imgResult.b64_json,
              diagnostics,
            };
          } else {
            // Image generation not supported, return error
            throw new Error('Image generation not supported by this model');
          }
        } else {
          // Chat request
          const messages = input.text
            ? [{ role: 'user', content: input.text }]
            : [];

          result = await client.chat(model.name, messages, keepAlive);
          diagnostics.timings![`attempt_${model.name}`] = Date.now() - attemptStart;

          return {
            chosen_model: model.name,
            task,
            text: result.message.content,
            diagnostics,
          };
        }
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
        errors: [
          ...(diagnostics.errors || []),
          { message: error.message || 'Fatal error' },
        ],
      },
    };
  }
}
