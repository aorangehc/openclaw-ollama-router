# OpenClaw Ollama Router

> Intelligent Ollama model routing plugin for OpenClaw with resource awareness

[![npm version](https://img.shields.io/npm/v/openclaw-ollama-router.svg)](https://www.npmjs.com/package/openclaw-ollama-router)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Test](https://github.com/aorangehc/openclaw-ollama-router/actions/workflows/test.yml/badge.svg)](https://github.com/aorangehc/openclaw-ollama-router/actions)

English | [中文](./docs/README.zh-CN.md)

## Overview

OpenClaw Ollama Router is a plugin that automatically routes tasks to the most appropriate Ollama model based on:

- **Task type**: chat, vision, image generation
- **Model capabilities**: detected from model info
- **Available resources**: VRAM, RAM, running models
- **User preferences**: speed vs quality

## Features

- **Automatic Model Discovery**: Lists all locally available Ollama models without downloading
- **Capability Detection**: Automatically detects vision support from model family/name
- **Resource Awareness**: Monitors VRAM usage and system memory to avoid OOM
- **Smart Routing**: Chooses the best model based on task and resources
- **Automatic Fallback**: If a model fails, automatically tries the next candidate
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Zero External Dependencies**: Uses native `fetch` for HTTP requests

## Quick Start

```bash
# Install
npm install openclaw-ollama-router

# Build
npm run build
```

See [Configuration](#configuration) and [Usage](#usage) below for details.

## Configuration

Add the plugin to your OpenClaw configuration:

```json
{
  "plugins": [
    {
      "name": "openclaw-ollama-router",
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

## Usage

### Tool: `ollama_route`

The main tool for routing requests to Ollama models.

#### Input Schema

```typescript
{
  task: "auto" | "chat" | "vision" | "image_generation",
  text?: string,
  images_b64?: string[],
  preference?: "speed" | "quality",
  max_retries?: number,
  keep_alive?: number | string
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
    errors?: any[],
    timings?: Record<string, number>
  }
}
```

### Examples

#### Vision Task

```json
{
  "tool": "ollama_route",
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
  "tool": "ollama_route",
  "input": {
    "task": "auto",
    "text": "Explain quantum computing",
    "preference": "quality"
  }
}
```

## Skill

The plugin includes a skill (`ollama-smart-router`) that instructs the main model when to use the routing tool. See [skills/ollama-smart-router/SKILL.md](skills/ollama-smart-router/SKILL.md) for details.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
npm run lint
```

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

## Related Links

- [Ollama](https://ollama.com/) - Local LLM runtime
- [OpenClaw](https://github.com/openclaw-ollama) - AI agent framework
- [Ollama API Documentation](https://github.com/ollama/ollama/blob/main/docs/api.md)

## License

MIT
