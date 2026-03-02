// OpenClaw Omni Router Plugin
// Main entry point

export * from './types/index.js';
export * from './ollama/client.js';
export * from './router/chooseModel.js';
export * from './handler.js';
export * from './system/hardware.js';

// Plugin metadata export for OpenClaw
export const pluginName = 'openclaw-omni-router';
export const toolName = 'omni_route';
export const toolNames = ['omni_inspect', 'omni_run', 'omni_route'] as const;
export const pluginVersion = '1.0.0';
