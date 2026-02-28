// OpenClaw Omni Router Plugin
// Main entry point

export * from './types/index.js';
export * from './ollama/client.js';
export * from './router/chooseModel.js';
export * from './handler.js';

// Plugin metadata export for OpenClaw
export const pluginName = 'openclaw-omni-router';
export const toolName = 'omni_route';
export const pluginVersion = '1.0.0';
