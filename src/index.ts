// OpenClaw Ollama Smart Router Plugin
// Main entry point

export * from './types/index.js';
export * from './ollama/client.js';
export * from './router/chooseModel.js';
export * from './handler.js';

// Plugin metadata export for OpenClaw
export const pluginName = 'ollama-smart-router';
export const pluginVersion = '1.0.0';
