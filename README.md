# OpenClaw Omni Router

> Intelligent Ollama model routing plugin for OpenClaw with resource awareness and voice support

[![npm version](https://img.shields.io/npm/v/openclaw-omni-router.svg)](https://www.npmjs.com/package/openclaw-omni-router)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Test](https://github.com/aorangehc/openclaw-omni-router/actions/workflows/test.yml/badge.svg)](https://github.com/aorangehc/openclaw-omni-router/actions)

English | [中文](./docs/README.zh-CN.md)

## Overview

OpenClaw Omni Router is a plugin that automatically routes tasks to the most appropriate Ollama model based on:

- **Task type**: chat, vision, image generation
- **Model capabilities**: detected from model info
- **Available resources**: VRAM, RAM, running models
- **User preferences**: speed vs quality
- **Voice input**: consumes transcript from `tools.media.audio`

## Features

- **Automatic Model Discovery**: Lists all locally available Ollama models without downloading
- **Capability Detection**: Automatically detects vision support from model family/name
- **Resource Awareness**: Monitors VRAM usage and system memory to avoid OOM
- **Smart Routing**: Chooses the best model based on task and resources
- **Automatic Fallback**: If a model fails, automatically tries the next candidate
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Zero External Dependencies**: Uses native `fetch` for HTTP requests
- **Voice Support**: Integrates with OpenClaw's audio transcription (STT) and TTS

## Quick Start

```bash
# Install
npm install openclaw-omni-router

# Build
npm run build
```

See [Configuration](#configuration) and [Usage](#usage) below for details.

## Installation

### Local Link Installation

For development or local testing:

```bash
# In the plugin directory
npm link

# In your OpenClaw project
npm link openclaw-omni-router
```

Then add to your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": [
    {
      "name": "openclaw-omni-router",
      "enabled": true,
      "config": {
        "baseUrl": "http://127.0.0.1:11434"
      }
    }
  ],
  "skills": ["omni-router"]
}
```

## Configuration

### Plugin Configuration

```json
{
  "plugins": [
    {
      "name": "openclaw-omni-router",
      "enabled": true,
      "config": {
        "baseUrl": "http://127.0.0.1:11434",
        "allowedModels": [],
        "defaultPreference": "speed",
        "defaultKeepAlive": 0,
        "requestTimeout": 120000
      }
    }
  ]
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | string | `http://127.0.0.1:11434` | Ollama API base URL |
| `allowedModels` | string[] | `[]` | Whitelist of model names. Empty = all models |
| `defaultPreference` | `"speed"` \| `"quality"` | `"speed"` | Default model preference |
| `defaultKeepAlive` | number \| string | `0` | Default keep-alive in seconds |
| `requestTimeout` | number | `120000` | Request timeout in ms |

## Voice Input (STT)

To enable voice input transcription, configure `tools.media.audio`:

### Local CLI (Recommended - Privacy/Free)

```json
{
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "provider": "cli",
        "cli": {
          "command": "whisper-cli",
          "args": ["-f", "{{MediaPath}}"]
        }
      }
    }
  }
}
```

Other local CLI options:
- **whisper.cpp**: `./main -m models/ggml-base.bin -f {{MediaPath}}`
- **sherpa-onnx-offline**: `sherpa-onnx-offline ... {{MediaPath}}`

### Provider (Cloud)

```json
{
  "tools": {
    "media": {
      "audio": {
        "enabled": true,
        "provider": "google",
        "providerConfig": {
          "apiKey": "your-api-key"
        }
      }
    }
  }
}
```

Available providers: `google`, `openai`, `anthropic`, `gemini`

## Voice Output (TTS)

To enable voice output, configure `messages.tts`:

### Auto Inbound Mode

```json
{
  "messages": {
    "tts": {
      "auto": "inbound"
    }
  }
}
```

Automatically reply with voice when user sends voice.

### Tagged Mode

```json
{
  "messages": {
    "tts": {
      "auto": "tagged"
    }
  }
}
```

Requires `[[tts]]` tag in response to trigger voice output.

### TTS Providers

| Provider | Description | Requires API Key |
|----------|-------------|------------------|
| `edge` | Microsoft Edge TTS (default) | No |
| `openai` | OpenAI TTS | Yes |
| `elevenlabs` | ElevenLabs TTS | Yes |

## Usage

### Tool: `omni_route`

The main tool for routing requests to Ollama models.

#### Input Schema

```typescript
{
  task: "auto" | "chat" | "vision" | "image_generation",
  text?: string,
  images_b64?: string[],
  preference?: "speed" | "quality",
  max_retries?: number,
  keep_alive?: number | string,
  context?: {
    hasAudio?: boolean,
    transcript?: string,
    channel?: string
  }
}
```

#### Response Schema

```typescript
{
  chosen_model: string,
  task: string,
  text?: string,
  image_b64?: string,
  diagnostics: {
    candidates_tried: string[],
    audio: {
      hasAudio: boolean,
      transcript_used: boolean,
      transcript_len?: number,
      note?: string
    },
    errors?: any[],
    timings?: Record<string, number>
  }
}
```

### Examples

#### Vision Task

```json
{
  "tool": "omni_route",
  "input": {
    "task": "vision",
    "text": "What is in this image?",
    "images_b64": ["base64..."]
  }
}
```

#### Chat with Quality Preference

```json
{
  "tool": "omni_route",
  "input": {
    "task": "auto",
    "text": "Explain quantum computing",
    "preference": "quality"
  }
}
```

#### Voice Input with Transcript

```json
{
  "tool": "omni_route",
  "input": {
    "task": "chat",
    "text": "What's the weather today?",
    "context": {
      "hasAudio": true,
      "transcript": "What's the weather today?",
      "channel": "telegram"
    }
  }
}
```

## Skill

The plugin includes a skill (`omni-router`) that instructs the main model when to use the routing tool and how to handle voice input/output. See [skills/omni-router/SKILL.md](skills/omni-router/SKILL.md) for detailed rules.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
npm run lint
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm run test:watch
```

### Test Structure

- `tests/router.test.ts` - Model selection and routing logic
- `tests/client.test.ts` - Ollama HTTP client
- `tests/handler.test.ts` - Tool handler integration
- `tests/voice.test.ts` - Voice scenario skill rules

## Troubleshooting

### Ollama Not Running

```
Error: connect ECONNREFUSED 127.0.0.1:11434
```

**Solution**: Start Ollama with `ollama serve`

### No Models Available

```
Error: No suitable models found
```

**Solution**: Install models with `ollama pull <model-name>`

### Out of Memory

The router automatically handles this by:
1. Detecting running models via `/api/ps`
2. Preferring smaller models under memory pressure
3. Falling back to smaller models on OOM errors

### Voice Not Transcribing

1. Ensure `tools.media.audio.enabled` is `true`
2. Check that CLI is in PATH (for local transcription)
3. Verify provider API key (for cloud transcription)
4. Check OpenClaw logs for transcription errors

### Voice Output Not Working

1. Ensure `messages.tts.auto` is configured
2. For tagged mode, ensure `[[tts]]` is in response
3. Check TTS provider configuration

## Cross-Platform Notes

### Windows
- Use PowerShell or CMD for CLI commands
- Whisper.cpp may require WSL or precompiled binaries

### macOS
- Homebrew packages available for whisper.cpp
- Native TTS via Edge works out of the box

### Linux
- Most CLI tools available via package managers
- Check PATH for locally compiled tools

## Related Links

- [Ollama](https://ollama.com/) - Local LLM runtime
- [OpenClaw](https://github.com/openclaw-ollama) - AI agent framework
- [Ollama API Documentation](https://github.com/ollama/ollama/blob/main/docs/api.md)

## License

MIT
