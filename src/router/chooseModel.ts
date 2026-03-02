// Model Router - Intelligent model selection based on task, capabilities, and resources

import * as os from 'os';
import type {
  CandidateModel,
  RouterOptions,
  TaskType,
  OllamaProcess,
} from '../types/index.js';

/**
 * Parameter size ordering (smaller to larger)
 * Used for sorting when preference=speed
 */
const PARAM_ORDER: Record<string, number> = {
  '3B': 1,
  '3b': 1,
  '7B': 2,
  '7b': 2,
  '8B': 3,
  '8b': 3,
  '12B': 4,
  '12b': 4,
  '13B': 5,
  '13b': 5,
  '14B': 6,
  '14b': 6,
  '33B': 7,
  '33b': 7,
  '34B': 8,
  '34b': 8,
  '70B': 9,
  '70b': 9,
  '80B': 10,
  '80b': 10,
  '405B': 11,
  '405b': 11,
};

/**
 * Detect task type from input
 * - vision: if images_b64 is provided
 * - image_generation: if text contains keywords like "draw", "generate", "create image"
 * - chat: default
 */
export function detectTaskType(
  text: string = '',
  images_b64?: string[]
): TaskType {
  // If images are provided, it's a vision task
  if (images_b64 && images_b64.length > 0) {
    return 'vision';
  }

  // Check for image generation keywords
  const imageGenKeywords = [
    'draw', 'generate', 'create image', 'make image',
    'generate image', 'create a picture', 'draw a picture',
    'generate a picture', '画', '生成图片', '生成图像',
  ];

  const lowerText = text.toLowerCase();
  for (const keyword of imageGenKeywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return 'image_generation';
    }
  }

  // Default to chat
  return 'chat';
}

/**
 * Check if a model supports the given task type
 */
function supportsTask(model: CandidateModel, task: TaskType): boolean {
  switch (task) {
    case 'vision':
      return model.hasVision;
    case 'image_generation':
      return model.hasImageGeneration;
    case 'chat':
      return !model.hasImageGeneration;
    case 'auto':
      return !model.hasImageGeneration;
    default:
      return true;
  }
}

function getChatPriority(model: CandidateModel): number {
  if (model.hasImageGeneration) {
    return 2;
  }

  if (model.hasVision) {
    return 1;
  }

  return 0;
}

/**
 * Get parameter size order for sorting
 */
function getParamOrder(size: string): number {
  const upperSize = size.toUpperCase();
  return PARAM_ORDER[upperSize] || 999;
}

/**
 * Calculate available system memory ratio
 * Returns 0-1 where higher means more memory available
 */
export function getAvailableMemoryRatio(): number {
  const total = os.totalmem();
  const free = os.freemem();
  return free / total;
}

/**
 * Build running models map for quick lookup
 */
function buildRunningMap(processes: OllamaProcess[]): Map<string, OllamaProcess> {
  const map = new Map<string, OllamaProcess>();
  for (const proc of processes) {
    map.set(proc.model, proc);
  }
  return map;
}

/**
 * Analyze running models to determine congestion level
 * Returns congestion score: 0 (idle) to 1 (very congested)
 */
function analyzeCongestion(
  runningModels: OllamaProcess[],
  candidates: CandidateModel[]
): number {
  if (runningModels.length === 0) {
    return 0;
  }

  // Calculate largest running model size
  let largestRunningSize = 0;

  for (const proc of runningModels) {
    if (proc.size > largestRunningSize) {
      largestRunningSize = proc.size;
    }
  }

  // Find the largest candidate model size
  let largestCandidateSize = 0;
  for (const candidate of candidates) {
    if (candidate.size > largestCandidateSize) {
      largestCandidateSize = candidate.size;
    }
  }

  // If a large model is already running, high congestion
  if (largestRunningSize > largestCandidateSize * 0.7) {
    return 0.8;
  }

  // If multiple models running, moderate congestion
  if (runningModels.length >= 2) {
    return 0.5;
  }

  // Light congestion
  return 0.2;
}

/**
 * Sort candidates based on preference and resource availability
 */
function sortCandidates(
  candidates: CandidateModel[],
  preference: 'speed' | 'quality',
  congestion: number,
  task: TaskType
): CandidateModel[] {
  const sorted = [...candidates];

  sorted.sort((a, b) => {
    // Running models get lower priority (we want to release them)
    if (a.isRunning && !b.isRunning) return 1;
    if (!a.isRunning && b.isRunning) return -1;

    if (task === 'chat') {
      const aChatPriority = getChatPriority(a);
      const bChatPriority = getChatPriority(b);
      if (aChatPriority !== bChatPriority) {
        return aChatPriority - bChatPriority;
      }
    }

    if (preference === 'speed') {
      // For speed: smaller parameters first
      const aOrder = getParamOrder(a.parameterSize);
      const bOrder = getParamOrder(b.parameterSize);
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      // Then smaller size
      return a.size - b.size;
    } else {
      // For quality: larger parameters first (if resources allow)
      if (congestion > 0.5) {
        // Under congestion, prefer smaller models
        const aOrder = getParamOrder(a.parameterSize);
        const bOrder = getParamOrder(b.parameterSize);
        return aOrder - bOrder;
      }
      // Otherwise, larger first
      const aOrder = getParamOrder(a.parameterSize);
      const bOrder = getParamOrder(b.parameterSize);
      return bOrder - aOrder;
    }
  });

  return sorted;
}

/**
 * Filter models by capability and allowed list
 */
export function filterByCapability(
  candidates: CandidateModel[],
  task: TaskType,
  allowedModels?: string[]
): CandidateModel[] {
  return candidates.filter(model => {
    // Filter by capability
    if (!supportsTask(model, task)) {
      return false;
    }

    // Filter by allowed list
    if (allowedModels && allowedModels.length > 0) {
      const modelBase = model.name.split(':')[0]; // e.g., "llama2" from "llama2:7b"
      return allowedModels.some(allowed => {
        // Exact match
        if (model.name === allowed) return true;
        // Full prefix match: "llama2:7b" starts with "llama2:7b"
        if (model.name.startsWith(allowed)) return true;
        // Base match: allowed="llama2" matches "llama2:7b" and "llama2:13b"
        if (allowed === modelBase) return true;
        return false;
      });
    }

    return true;
  });
}

/**
 * Main router function - select the best model for the task
 */
export function chooseModel(
  candidates: CandidateModel[],
  options: RouterOptions
): CandidateModel[] {
  const { task, preference = 'speed', allowedModels } = options;

  // 1. Auto-detect task type if needed
  const actualTask = task === 'auto'
    ? detectTaskType(options.text, options.images_b64)
    : task;

  // 2. Build running models map
  const runningMap = buildRunningMap(options._runningProcesses || []);

  // 3. Mark candidates with running status
  const enrichedCandidates = candidates.map(model => {
    const running = runningMap.get(model.name);
    return {
      ...model,
      isRunning: !!running,
      runningSize: running?.size,
    } as CandidateModel;
  });

  // 4. Filter by capability and allowed models
  const filtered = filterByCapability(enrichedCandidates, actualTask, allowedModels);

  if (filtered.length === 0) {
    // If no models match, return empty (will trigger error)
    return [];
  }

  // 5. Analyze system congestion
  const congestion = analyzeCongestion(
    options._runningProcesses || [],
    enrichedCandidates
  );
  const availableMemoryRatio = options._availableMemoryRatio ?? getAvailableMemoryRatio();

  const preferred: CandidateModel[] = [];
  const demoted: CandidateModel[] = [];

  for (const model of filtered) {
    if (shouldDemote(model, availableMemoryRatio, congestion)) {
      demoted.push(model);
    } else {
      preferred.push(model);
    }
  }

  return [
    ...sortCandidates(preferred, preference, congestion, actualTask),
    ...sortCandidates(demoted, 'speed', congestion, actualTask),
  ];
}

/**
 * Check if a model should be demoted due to resource constraints
 */
export function shouldDemote(
  model: CandidateModel,
  availableMemoryRatio: number,
  congestion: number
): boolean {
  // Demote large models if memory is low
  if (availableMemoryRatio < 0.3 && getParamOrder(model.parameterSize) > 5) {
    return true;
  }

  // Demote if very congested and model is running
  if (congestion > 0.7 && model.isRunning) {
    return true;
  }

  return false;
}
