// Unit tests for Model Router

import { describe, it, expect, vi } from 'vitest';
import {
  detectTaskType,
  filterByCapability,
  chooseModel,
  getAvailableMemoryRatio,
  shouldDemote,
} from '../src/router/chooseModel.js';
import type { CandidateModel, RouterOptions } from '../src/types/index.js';

describe('Router', () => {
  describe('detectTaskType', () => {
    it('should return vision when images_b64 provided', () => {
      expect(detectTaskType('hello', ['base64data'])).toBe('vision');
    });

    it('should return image_generation for draw keyword', () => {
      expect(detectTaskType('draw a picture')).toBe('image_generation');
    });

    it('should return image_generation for generate keyword', () => {
      expect(detectTaskType('generate an image')).toBe('image_generation');
    });

    it('should return image_generation for Chinese keywords', () => {
      expect(detectTaskType('画一幅画')).toBe('image_generation');
      expect(detectTaskType('生成图片')).toBe('image_generation');
    });

    it('should return chat by default', () => {
      expect(detectTaskType('hello')).toBe('chat');
      expect(detectTaskType('')).toBe('chat');
    });
  });

  describe('filterByCapability', () => {
    const candidates: CandidateModel[] = [
      {
        name: 'llama2:7b',
        size: 4000000000,
        hasVision: false,
        hasImageGeneration: false,
        parameterSize: '7B',
        quantizationLevel: 'Q4_0',
        isRunning: false,
      },
      {
        name: 'llava:7b',
        size: 4500000000,
        hasVision: true,
        hasImageGeneration: false,
        parameterSize: '7B',
        quantizationLevel: 'Q4_0',
        isRunning: false,
      },
    ];

    it('should filter vision models for vision task', () => {
      const result = filterByCapability(candidates, 'vision');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('llava:7b');
    });

    it('should return all models for chat task', () => {
      const result = filterByCapability(candidates, 'chat');
      expect(result).toHaveLength(2);
    });

    it('should exclude image generation models from chat task', () => {
      const result = filterByCapability([
        ...candidates,
        {
          name: 'flux:latest',
          size: 5700000000,
          hasVision: false,
          hasImageGeneration: true,
          parameterSize: '8B',
          quantizationLevel: 'FP4',
          isRunning: false,
        },
      ], 'chat');
      expect(result.map(model => model.name)).not.toContain('flux:latest');
    });

    it('should filter by allowedModels whitelist', () => {
      const result = filterByCapability(candidates, 'chat', ['llama2']);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('llama2:7b');
    });
  });

  describe('chooseModel', () => {
    const baseCandidates: CandidateModel[] = [
      {
        name: 'llama2:7b',
        size: 4000000000,
        hasVision: false,
        hasImageGeneration: false,
        parameterSize: '7B',
        quantizationLevel: 'Q4_0',
        isRunning: false,
      },
      {
        name: 'llama2:13b',
        size: 8000000000,
        hasVision: false,
        hasImageGeneration: false,
        parameterSize: '13B',
        quantizationLevel: 'Q4_0',
        isRunning: false,
      },
      {
        name: 'llava:7b',
        size: 4500000000,
        hasVision: true,
        hasImageGeneration: false,
        parameterSize: '7B',
        quantizationLevel: 'Q4_0',
        isRunning: false,
      },
    ];

    it('should sort by size for speed preference', () => {
      const options: RouterOptions = {
        task: 'chat',
        preference: 'speed',
      };

      const result = chooseModel(baseCandidates, options);
      expect(result[0].parameterSize).toBe('7B');
    });

    it('should prefer text-only models over vision models for chat', () => {
      const options: RouterOptions = {
        task: 'chat',
        preference: 'speed',
      };

      const result = chooseModel(baseCandidates, options);
      expect(result[0].name).toBe('llama2:7b');
      expect(result[1].name).toBe('llama2:13b');
      expect(result[2].name).toBe('llava:7b');
    });

    it('should sort by size descending for quality preference', () => {
      const options: RouterOptions = {
        task: 'chat',
        preference: 'quality',
        _runningProcesses: [],
        _availableMemoryRatio: 0.9,
      };

      const result = chooseModel(baseCandidates, options);
      expect(result[0].parameterSize).toBe('13B');
    });

    it('should prefer smaller models for quality requests under congestion', () => {
      const options: RouterOptions = {
        task: 'chat',
        preference: 'quality',
        _runningProcesses: [
          { id: '1', model: 'busy:70b', size: 7_000_000_000, duration: 1000 },
        ],
        _availableMemoryRatio: 0.9,
      };

      const result = chooseModel(baseCandidates, options);
      expect(result[0].parameterSize).toBe('7B');
    });

    it('should prioritize non-running models', () => {
      const candidatesWithRunning: CandidateModel[] = [
        {
          ...baseCandidates[0],
          isRunning: true,
          runningSize: 4000000000,
        },
        {
          ...baseCandidates[1],
          isRunning: false,
        },
      ];

      const options: RouterOptions = {
        task: 'chat',
        preference: 'speed',
        _runningProcesses: [{ id: '1', model: 'llama2:7b', size: 4000000000, duration: 1000 }],
        _availableMemoryRatio: 0.9,
      };

      const result = chooseModel(candidatesWithRunning, options);
      // Non-running should come first
      expect(result[0].isRunning).toBe(false);
    });

    it('should filter vision models for vision task', () => {
      const options: RouterOptions = {
        task: 'vision',
        preference: 'speed',
      };

      const result = chooseModel(baseCandidates, options);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('llava:7b');
    });

    it('should respect allowedModels whitelist', () => {
      const options: RouterOptions = {
        task: 'chat',
        preference: 'speed',
        allowedModels: ['llama2:7b'],
        _availableMemoryRatio: 0.9,
      };

      const result = chooseModel(baseCandidates, options);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('llama2:7b');
    });

    it('should return empty when no models match', () => {
      const options: RouterOptions = {
        task: 'vision',
        preference: 'speed',
        allowedModels: ['nonexistent'],
        _availableMemoryRatio: 0.9,
      };

      const result = chooseModel(baseCandidates, options);
      expect(result).toHaveLength(0);
    });

    it('should keep demoted large models behind safer choices when memory is low', () => {
      const lowMemoryCandidates: CandidateModel[] = [
        {
          ...baseCandidates[0],
          name: 'llama2:7b',
          parameterSize: '7B',
        },
        {
          ...baseCandidates[1],
          name: 'llama2:33b',
          parameterSize: '33B',
          size: 16_000_000_000,
        },
      ];

      const options: RouterOptions = {
        task: 'chat',
        preference: 'quality',
        _runningProcesses: [],
        _availableMemoryRatio: 0.2,
      };

      const result = chooseModel(lowMemoryCandidates, options);
      expect(result[0].name).toBe('llama2:7b');
      expect(result[1].name).toBe('llama2:33b');
    });

    it('should route image generation only to capable models', () => {
      const imageCandidates: CandidateModel[] = [
        {
          ...baseCandidates[0],
          name: 'flux:latest',
          hasImageGeneration: true,
          parameterSize: '12B',
        },
        baseCandidates[0],
      ];

      const options: RouterOptions = {
        task: 'image_generation',
        preference: 'speed',
        _runningProcesses: [],
        _availableMemoryRatio: 0.9,
      };

      const result = chooseModel(imageCandidates, options);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('flux:latest');
    });

    it('should not include image-generation models in chat recommendations', () => {
      const options: RouterOptions = {
        task: 'chat',
        preference: 'speed',
      };

      const result = chooseModel([
        ...baseCandidates,
        {
          ...baseCandidates[0],
          name: 'flux:latest',
          hasImageGeneration: true,
          parameterSize: '8B',
          size: 5_700_000_000,
        },
      ], options);

      expect(result.map(model => model.name)).not.toContain('flux:latest');
    });
  });

  describe('getAvailableMemoryRatio', () => {
    it('should return value between 0 and 1', () => {
      const ratio = getAvailableMemoryRatio();
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThanOrEqual(1);
    });
  });

  describe('shouldDemote', () => {
    const largeRunningModel: CandidateModel = {
      name: 'llama2:70b',
      size: 40_000_000_000,
      hasVision: false,
      hasImageGeneration: false,
      parameterSize: '70B',
      quantizationLevel: 'Q4_0',
      isRunning: true,
    };

    it('demotes large models when memory is low', () => {
      expect(shouldDemote(largeRunningModel, 0.2, 0.1)).toBe(true);
    });

    it('demotes running models when congestion is severe', () => {
      expect(shouldDemote(largeRunningModel, 0.8, 0.9)).toBe(true);
    });

    it('keeps smaller idle models available', () => {
      expect(shouldDemote({ ...largeRunningModel, parameterSize: '7B', isRunning: false }, 0.8, 0.1)).toBe(false);
    });
  });
});
