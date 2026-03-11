# OpenClaw Omni Router

> OpenClaw plugin that lets the main model inspect local Ollama capacity, choose a local model, and execute it.

[![npm version](https://img.shields.io/npm/v/openclaw-omni-router.svg)](https://www.npmjs.com/package/openclaw-omni-router)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Test](https://github.com/aorangehc/openclaw-omni-router/actions/workflows/test.yml/badge.svg)](https://github.com/aorangehc/openclaw-omni-router/actions)

English | [中文](./docs/README.zh-CN.md)

## Overview

This plugin exposes three OpenClaw tools:

- `omni_inspect`: list local Ollama models, current running state, and hardware availability
- `omni_run`: execute one exact Ollama model chosen by the main model
- `omni_route`: compatibility tool that still does inspect + choose + execute in one step

The intended flow is:

1. The main model decides whether it can answer directly.
2. If local multimodal or local inference is needed, it calls `omni_inspect`.
3. The main model chooses a model from `recommended_models` or from the raw `models` list.
4. It calls `omni_run`.
5. It reads the tool result, then responds to the user.

This keeps routing policy in the main model while keeping execution and error handling in the plugin.

## Install

```bash
npm install
npm run build
npm run install:openclaw
```

Equivalent raw command:

```bash
openclaw plugins install /absolute/path/to/openclaw-ollama-router --link
```

## Uninstall

```bash
npm run uninstall:openclaw
```

Equivalent raw command:

```bash
openclaw plugins uninstall openclaw-omni-router --force --keep-files
```

`--keep-files` is the safe default for linked installs. It removes the OpenClaw config/install record without deleting your working tree.

## Configuration

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/absolute/path/to/openclaw-ollama-router"
      ]
    },
    "entries": {
      "openclaw-omni-router": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:11434",
          "allowedModels": [],
          "defaultPreference": "speed",
          "defaultKeepAlive": 0,
          "requestTimeout": 120000
        }
      }
    }
  },
  "skills": {
    "entries": {
      "omni-router": {
        "enabled": true
      }
    }
  }
}
```

Options:

- `baseUrl`: Ollama API base URL
- `allowedModels`: exact names or prefixes allowed for execution; empty means all discovered models
- `defaultPreference`: default recommendation order for `omni_inspect` and `omni_route`
- `defaultKeepAlive`: default Ollama keep-alive
- `requestTimeout`: HTTP timeout in milliseconds

## Tool Contracts

### `omni_inspect`

Use when the main model needs to decide whether local execution makes sense.

Input:

```ts
{
  task?: "auto" | "chat" | "vision" | "image_generation",
  text?: string,
  images_b64?: string[],
  preference?: "speed" | "quality",
  context?: {
    hasAudio?: boolean,
    transcript?: string,
    channel?: string
  }
}
```

Output includes:

- `task`: resolved task type
- `hardware`: system RAM snapshot and best-effort NVIDIA GPU memory info
- `models`: discovered Ollama models with `allowed`, `embedding`, `supportsResolvedTask`, running state, and inferred capabilities
- `recommended_models`: current heuristic ordering from the legacy router

### `omni_run`

Use when the main model has already chosen an exact Ollama model.

Input:

```ts
{
  model: string,
  task: "auto" | "chat" | "vision" | "image_generation",
  text?: string,
  images_b64?: string[],
  keep_alive?: number | string,
  context?: {
    hasAudio?: boolean,
    transcript?: string,
    channel?: string
  }
}
```

Output includes:

- `chosen_model`
- `task`
- `text` or `image_b64`
- `diagnostics.errors` with raw Ollama/runtime failures when execution fails

### `omni_route`

Compatibility tool for one-shot routing. It still works and now shares the same execution path as `omni_run`.

## Skill Behavior

The bundled skill lives at `skills/omni-router/SKILL.md`.

The skill should follow this policy:

1. If the main model can answer directly, answer directly.
2. If local multimodal or local inference is needed, call `omni_inspect`.
3. Let the main model choose the final model using `models`, `recommended_models`, and the hardware snapshot.
4. Call `omni_run`.
5. Only use `omni_route` as a fallback or compatibility path.

## Voice Input

If you want voice messages transcribed into tool input, enable `tools.media.audio` in OpenClaw. The plugin consumes the transcript and records audio-aware diagnostics, but it does not perform speech-to-text itself.

## Development

```bash
npm test
npm run build
```

## Live OpenClaw Tests

The smoke test script can exercise both flows:

```bash
# Legacy one-shot routing
bash scripts/openclaw-smoke-test.sh chat
bash scripts/openclaw-smoke-test.sh vision
bash scripts/openclaw-smoke-test.sh image_generation

# Model-guided flow
bash scripts/openclaw-smoke-test.sh guided_chat
bash scripts/openclaw-smoke-test.sh guided_vision
bash scripts/openclaw-smoke-test.sh guided_image_generation

# Run everything
npm run test:openclaw
```

Guided modes print both `omni_inspect` and `omni_run` tool results from the real OpenClaw session log.

For image generation, the plugin now surfaces the raw Ollama error back to OpenClaw. On Linux, current Ollama image-generation support may still fail at runtime even when the model is installed.

## License

MIT
