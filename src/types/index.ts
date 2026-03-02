// Type definitions for OpenClaw Omni Router

// ==================== Configuration ====================

export interface PluginConfig {
  baseUrl: string;
  allowedModels?: string[];
  defaultPreference?: 'speed' | 'quality';
  defaultKeepAlive?: number | string;
  requestTimeout?: number;
}

// ==================== Ollama API Types ====================

export interface OllamaTag {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

export interface OllamaTagsResponse {
  models: OllamaTag[];
}

export interface OllamaModelDetails {
  parent_model: string;
  format: string;
  family: string;
  families: string[];
  parameter_size: string;
  quantization_level: string;
}

export interface OllamaModelInfo {
  modelfile: string;
  parameters: string;
  template: string;
  details: OllamaModelDetails;
}

export interface OllamaShowResponse {
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: OllamaModelDetails;
}

export interface OllamaProcess {
  id: string;
  model: string;
  size: number;
  duration: number;
}

export interface OllamaPsResponse {
  models: OllamaProcess[];
}

// ==================== Router Types ====================

export type TaskType = 'auto' | 'chat' | 'vision' | 'image_generation';
export type Preference = 'speed' | 'quality';

export interface ModelCapability {
  name: string;
  size: number;
  hasVision: boolean;
  hasImageGeneration: boolean;
  parameterSize: string;
  quantizationLevel: string;
}

export interface ModelInspection extends ModelCapability {
  family?: string;
  families: string[];
}

export interface CandidateModel extends ModelCapability {
  isRunning: boolean;
  runningSize?: number;
}

export interface RouterOptions {
  task: TaskType;
  text?: string;
  images_b64?: string[];
  preference?: Preference;
  maxRetries?: number;
  keepAlive?: number | string;
  allowedModels?: string[];
  // Internal fields (set by handler)
  _runningProcesses?: OllamaProcess[];
  _availableMemoryRatio?: number;
}

// ==================== Response Types ====================

export interface AudioContext {
  hasAudio?: boolean;
  transcript?: string;
  channel?: string;
}

export interface HardwareGpu {
  name: string;
  driverVersion?: string;
  memoryTotalMiB?: number;
  memoryFreeMiB?: number;
  memoryUsedMiB?: number;
}

export interface HardwareSnapshot {
  platform: string;
  arch: string;
  cpuCount: number;
  totalMemory: number;
  freeMemory: number;
  availableMemoryRatio: number;
  gpuCount: number;
  gpus: HardwareGpu[];
}

export interface InspectModel extends CandidateModel {
  modifiedAt: string;
  digest: string;
  allowed: boolean;
  embedding: boolean;
  supportsResolvedTask: boolean;
  family?: string;
  families: string[];
}

export interface AudioDiagnostics {
  hasAudio: boolean;
  transcript_used: boolean;
  transcript_len?: number;
  channel?: string;
  note?: string;
}

export interface Diagnostics {
  candidates_tried: string[];
  audio: AudioDiagnostics;
  errors?: Record<string, unknown>[];
  timings?: Record<string, number>;
  fallback?: string;
}

export interface OmniRouteResponse {
  chosen_model: string;
  task: TaskType;
  text?: string;
  image_b64?: string;
  diagnostics: Diagnostics;
}

export type OllamaRouteResponse = OmniRouteResponse;

export interface OmniInspectSummary {
  totalModels: number;
  allowedModels: number;
  runningModels: number;
  recommendedModels: number;
}

export interface OmniInspectResponse {
  task: TaskType;
  text?: string;
  summary: OmniInspectSummary;
  hardware: HardwareSnapshot;
  models: InspectModel[];
  recommended_models: string[];
  diagnostics: Diagnostics;
}

export interface OmniRunResponse extends OmniRouteResponse {}

// ==================== Tool Handler Types ====================

export interface ToolInput {
  task: TaskType;
  text?: string;
  images_b64?: string[];
  preference?: Preference;
  max_retries?: number;
  keep_alive?: number | string;
  context?: AudioContext;
}

export interface InspectInput {
  task?: TaskType;
  text?: string;
  images_b64?: string[];
  preference?: Preference;
  context?: AudioContext;
}

export interface RunInput extends ToolInput {
  model: string;
  use_recommended_model?: boolean;
  allow_recommendation_override?: boolean;
}

// ==================== Utility Types ====================

export interface ApiError {
  status?: number;
  message: string;
  code?: string;
}
