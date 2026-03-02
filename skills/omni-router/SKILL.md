---
name: omni-router
description: Let the main model inspect local Ollama capacity, choose a local model, and execute it through OpenClaw tools
trigger: auto
priority: high
---

```json
{
  "skill": "omni-router",
  "version": "2.0.0"
}
```

# Omni Router Skill

Use this skill when the user request may benefit from local Ollama execution, including:

1. image understanding
2. OCR
3. image generation
4. local/private chat inference
5. mixed cloud + local reasoning
6. voice input that already has a transcript

## Core Policy

Follow this order:

1. Decide whether you can answer directly without local execution.
2. If direct answering is sufficient, answer directly and do not call these tools.
3. If local execution is needed, call `omni_inspect`.
4. Read `recommended_models[0]`.
5. Call `omni_run` with `use_recommended_model: true`.
6. If that `omni_run` call fails, stop and surface the failure. Do not retry a second model unless the user explicitly asks.
7. Read the tool result and respond to the user.

Use `omni_route` only as a compatibility fallback when you explicitly want one-shot routing.

## Tool Selection

### `omni_inspect`

Use `omni_inspect` to see:

- local Ollama models
- inferred capabilities
- running state
- allowed / disallowed status
- system memory snapshot
- best-effort NVIDIA GPU memory snapshot
- recommended model ordering

Preferred inputs:

```json
{
  "task": "auto",
  "text": "user request",
  "images_b64": []
}
```

If the request includes images, pass them in `images_b64`.

If the request came from audio and OpenClaw provides a transcript, pass:

```json
{
  "context": {
    "hasAudio": true,
    "transcript": "transcribed text",
    "channel": "telegram"
  }
}
```

## Choosing a Model

After `omni_inspect`, apply these rules:

1. If `recommended_models` is not empty, you must use `recommended_models[0]`.
2. When you call `omni_run`, set `use_recommended_model = true` so the tool enforces `recommended_models[0]` even if you are tempted to pick another model.
3. If `recommended_models` is empty, choose the first model where:
   - `allowed = true`
   - `supportsResolvedTask = true`
4. If you need a specific tradeoff, inspect `parameterSize`, `quantizationLevel`, `isRunning`, `hardware`, and the raw model list yourself only to understand why the recommendation looks the way it does.
5. Do not choose models where `allowed = false`.
6. Do not retry a second local model after a failed `use_recommended_model = true` run unless the user explicitly asks for fallback behavior.

## `omni_run`

Use `omni_run` when you have chosen the exact model name.

Example:

```json
{
  "tool": "omni_run",
  "input": {
    "model": "qwen3-vl:4b",
    "use_recommended_model": true,
    "task": "vision",
    "text": "Describe this screenshot briefly",
    "images_b64": ["..."]
  }
}
```

`omni_run` will:

- execute that exact model
- return `text` or `image_b64`
- preserve raw Ollama/runtime errors in `diagnostics.errors`

## `omni_route`

Use `omni_route` only when:

1. you intentionally want one-step legacy behavior
2. you do not need the intermediate inspect result
3. you want built-in fallback attempts without making the selection yourself

## Voice Input

If `{{Transcript}}` is available, treat it as the user's actual text.

If the user sent audio but no transcript is available:

1. do not guess what the audio said
2. do not call local execution tools with empty text
3. tell the user that audio transcription must be enabled in OpenClaw

## Voice Output

Voice output is still controlled by OpenClaw `messages.tts`.

If TTS mode is `tagged` and the conversation came from voice/audio, append `[[tts]]` to the final natural-language reply.

## Examples

### Example 1: Screenshot analysis

1. Call `omni_inspect` with `task: "vision"` and `images_b64`.
2. Use `recommended_models[0]`.
3. Call `omni_run`.
4. If it fails, report that failure and stop.
5. Summarize the result for the user.

### Example 2: Image generation

1. Call `omni_inspect` with `task: "image_generation"`.
2. If there is no allowed image-generation model, tell the user directly.
3. Otherwise call `omni_run` with `use_recommended_model: true`.
4. If `diagnostics.errors` contains a runtime error, surface that as an environment/model failure, not as a plugin failure, and do not retry another model.

### Example 3: Simple chat

If the main model can answer directly, do not call the plugin.

Only call `omni_inspect` + `omni_run` when the user explicitly wants local Ollama execution or when local execution adds capability that the main model does not have.
