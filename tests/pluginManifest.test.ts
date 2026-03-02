import { describe, expect, it } from 'vitest';

import pluginManifest from '../openclaw.plugin.json';

describe('plugin manifest', () => {
  it('points OpenClaw skill discovery at the plugin skills root', () => {
    expect(pluginManifest.id).toBe('openclaw-omni-router');
    expect(pluginManifest.skills).toEqual(['skills']);
  });
});
