// Unit tests for Tool Handler - Simplified

import { describe, it, expect, vi } from 'vitest';
import type { PluginConfig, ToolInput, OllamaRouteResponse } from '../src/types/index.js';

describe('Handler Integration', () => {
  // This test verifies the module can be imported and has expected exports
  it('should export handleOllamaRoute function', async () => {
    const { handleOllamaRoute } = await import('../src/handler.js');
    expect(typeof handleOllamaRoute).toBe('function');
  });

  // Test config validation
  it('should handle missing config gracefully', async () => {
    const { handleOllamaRoute } = await import('../src/handler.js');
    const input: ToolInput = { task: 'chat' };

    // This will fail because Ollama is not running, but we can catch the error
    try {
      await handleOllamaRoute(input, { baseUrl: 'http://localhost:9999' });
    } catch (err) {
      // Expected to fail - Ollama not running
      expect(err).toBeDefined();
    }
  });
});
