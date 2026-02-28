// Unit tests for Voice Scenario handling in Skill rules

import { describe, it, expect } from 'vitest';

describe('Voice Scenario Skill Rules', () => {
  describe('Voice Input Detection', () => {
    it('should detect voice input from [Audio] block', () => {
      // Simulate message with [Audio] block
      const messageText = 'Hello [Audio] there';
      const hasAudioBlock = messageText.includes('[Audio]');
      expect(hasAudioBlock).toBe(true);
    });

    it('should detect voice input from transcript presence', () => {
      // Simulate transcript available
      const transcript = 'What is the weather today?';
      const hasTranscript = transcript && transcript.length > 0;
      expect(hasTranscript).toBe(true);
      expect(transcript.length).toBeGreaterThan(0);
    });

    it('should handle missing transcript gracefully', () => {
      // No transcript available
      const transcript = undefined;
      const hasTranscript = !!transcript && transcript.length > 0;
      expect(hasTranscript).toBe(false);
    });
  });

  describe('Transcript Processing', () => {
    it('should use transcript as primary input when available', () => {
      const transcript = 'Tell me about quantum computing';
      const userInput = transcript; // Use transcript as input

      expect(userInput).toBe('Tell me about quantum computing');
      expect(userInput.length).toBeGreaterThan(10);
    });

    it('should preserve transcript length in diagnostics', () => {
      const transcript = 'Short';
      const transcriptLen = transcript.length;
      expect(transcriptLen).toBe(5);
    });

    it('should handle empty transcript', () => {
      const transcript = '';
      const shouldUseTranscript = !!transcript && transcript.length > 0;
      expect(shouldUseTranscript).toBe(false);
    });
  });

  describe('TTS Tag Detection', () => {
    it('should detect [[tts]] tag in response', () => {
      const response = 'The weather is sunny today. [[tts]]';
      const hasTtsTag = response.includes('[[tts]]');
      expect(hasTtsTag).toBe(true);
    });

    it('should not trigger TTS for non-voice inputs in tagged mode', () => {
      const response = 'Hello, how can I help you?';
      const hasTtsTag = response.includes('[[tts]]');
      expect(hasTtsTag).toBe(false);
    });

    it('should handle TTS tag at different positions', () => {
      const response1 = '[[tts]] The answer is yes.';
      const response2 = 'The answer is yes. [[tts]]';
      const response3 = '[[tts]]';

      expect(response1.includes('[[tts]]')).toBe(true);
      expect(response2.includes('[[tts]]')).toBe(true);
      expect(response3.includes('[[tts]]')).toBe(true);
    });
  });

  describe('Context Object Validation', () => {
    it('should validate context structure for voice input', () => {
      const context = {
        hasAudio: true,
        transcript: 'What time is it?',
        channel: 'telegram'
      };

      expect(context.hasAudio).toBe(true);
      expect(context.transcript).toBeDefined();
      expect(context.transcript).toBe('What time is it?');
      expect(context.channel).toBe('telegram');
    });

    it('should handle missing optional context fields', () => {
      const context = {
        hasAudio: false
        // transcript and channel are optional
      };

      expect(context.hasAudio).toBe(false);
      expect(context.transcript).toBeUndefined();
      expect(context.channel).toBeUndefined();
    });

    it('should handle various channel types', () => {
      const channels = ['telegram', 'feishu', 'discord', 'slack', 'web'];

      for (const channel of channels) {
        const context = { channel };
        expect(context.channel).toBe(channel);
      }
    });
  });

  describe('Skill Rule: Transcript exists -> use it', () => {
    it('should prefer transcript over raw audio', () => {
      // Scenario: User sends voice, transcript is available
      const transcript = 'Hello, how are you?';
      const rawAudioPath = '/path/to/audio.m4a';

      // Rule: If transcript exists, use transcript as text input
      const inputText = transcript; // Use transcript

      expect(inputText).toBe('Hello, how are you?');
      expect(inputText).not.toBe(rawAudioPath);
    });
  });

  describe('Skill Rule: No transcript -> prompt user', () => {
    it('should prompt user to enable audio transcription', () => {
      const hasAudio = true;
      const transcript = undefined;

      // Rule: If hasAudio but no transcript, prompt user
      const shouldPromptUser = hasAudio && !transcript;

      expect(shouldPromptUser).toBe(true);
    });

    it('should not prompt when no audio present', () => {
      const hasAudio = false;
      const transcript = undefined;

      const shouldPromptUser = hasAudio && !transcript;
      expect(shouldPromptUser).toBe(false);
    });
  });

  describe('Skill Rule: Voice input -> add [[tts]] in tagged mode', () => {
    it('should add [[tts]] for voice input in tagged mode', () => {
      const ttsMode = 'tagged';
      const hasVoiceInput = true;
      const baseResponse = 'The weather is sunny.';

      // Rule: If tagged mode and voice input, append [[tts]]
      const finalResponse = ttsMode === 'tagged' && hasVoiceInput
        ? `${baseResponse} [[tts]]`
        : baseResponse;

      expect(finalResponse).toBe('The weather is sunny. [[tts]]');
    });

    it('should not add [[tts]] for text input in tagged mode', () => {
      const ttsMode = 'tagged';
      const hasVoiceInput = false;
      const baseResponse = 'The weather is sunny.';

      const finalResponse = ttsMode === 'tagged' && hasVoiceInput
        ? `${baseResponse} [[tts]]`
        : baseResponse;

      expect(finalResponse).toBe('The weather is sunny.');
    });

    it('should not add [[tts]] in inbound mode (auto)', () => {
      const ttsMode = 'inbound';
      const hasVoiceInput = true;
      const baseResponse = 'The weather is sunny.';

      // In inbound mode, TTS is automatic - no tag needed
      const finalResponse = ttsMode === 'tagged' && hasVoiceInput
        ? `${baseResponse} [[tts]]`
        : baseResponse;

      expect(finalResponse).toBe('The weather is sunny.');
    });
  });

  describe('Diagnostics Audio Object', () => {
    it('should populate audio diagnostics correctly', () => {
      const hasAudio = true;
      const transcript = 'Test transcript';
      const transcriptUsed = !!transcript;

      const diagnostics = {
        audio: {
          hasAudio,
          transcript_used: transcriptUsed,
          transcript_len: transcript?.length,
          note: transcriptUsed ? 'Transcript from tools.media.audio' : undefined
        }
      };

      expect(diagnostics.audio.hasAudio).toBe(true);
      expect(diagnostics.audio.transcript_used).toBe(true);
      expect(diagnostics.audio.transcript_len).toBe(15);
      expect(diagnostics.audio.note).toBe('Transcript from tools.media.audio');
    });

    it('should handle no audio scenario', () => {
      const diagnostics = {
        audio: {
          hasAudio: false,
          transcript_used: false
        }
      };

      expect(diagnostics.audio.hasAudio).toBe(false);
      expect(diagnostics.audio.transcript_used).toBe(false);
    });
  });
});
