// Unit tests for Model Router

import { describe, it, expect, vi } from 'vitest';
import {
  detectTaskType,
  filterByCapability,
  chooseModel,
  getAvailableMemoryRatio,
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

    it('should sort by size descending for quality preference', () => {
      const options: RouterOptions = {
        task: 'chat',
        preference: 'quality',
        _runningProcesses: [],
      };

      const result = chooseModel(baseCandidates, options);
      expect(result[0].parameterSize).toBe('13B');
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
      };

      const result = chooseModel(baseCandidates, options);
      expect(result).toHaveLength(0);
    });
  });

  describe('getAvailableMemoryRatio', () => {
    it('should return value between 0 and 1', () => {
      const ratio = getAvailableMemoryRatio();
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThanOrEqual(1);
    });
  });
});
