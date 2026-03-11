---
name: omni-router
description: Let the main model inspect local Ollama capacity, choose a local model, and execute it through OpenClaw tools
trigger: auto
priority: high
---

```json
{
  "skill": "omni-router",
  "version": "2.0.1"
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
4. Read `models`, `recommended_models`, and `hardware`, then decide the exact model yourself.
5. Call `omni_run` with the exact model you chose.
6. If that `omni_run` call fails, stop and surface the failure. Do not retry a second model unless the user explicitly asks.
7. Read the tool result and respond to the user.

Use `omni_route` only as a compatibility fallback when you explicitly want one-shot routing.

## Telegram / Attachment Policy

When the user sends an image from Telegram or another chat channel:

1. Do not ask the user to manually convert the image to base64.
2. Do not ask the user to manually provide a file path.
3. If the runtime already exposes attachment file paths, pass them via `image_paths`.
4. If the runtime already exposes base64 image content, pass it via `images_b64`.
5. Do not claim that the image cannot be passed before you have actually called `omni_inspect` or `omni_run` with `image_paths` or `images_b64`.
6. For image requests, prefer using the local Ollama toolchain first when local execution is available.

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

If the channel/tooling gives you local attachment file paths instead of base64, pass them in `image_paths`. Do not pass a file path inside `text` and assume the plugin will parse it from prose.

If both `image_paths` and `images_b64` are available, you may pass both.

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

1. Treat `recommended_models` as a heuristic reference, not a hard requirement.
2. Choose the final model yourself using the request, `models`, `recommended_models`, and `hardware`.
3. The chosen model must satisfy:
   - `allowed = true`
   - `supportsResolvedTask = true`
4. If you need a specific tradeoff, inspect `parameterSize`, `quantizationLevel`, `isRunning`, `hardware`, and the raw model list.
5. Do not choose models where `allowed = false`.
6. Do not retry a second local model after a failed run unless the user explicitly asks for fallback behavior.
7. For OCR requests, prefer models that are actually listed in local `models` and support the resolved task. For general image understanding, prefer general vision-capable local models.

## `omni_run`

Use `omni_run` when you have chosen the exact model name.

Example:

```json
{
  "tool": "omni_run",
  "input": {
    "model": "qwen3-vl:4b",
    "task": "vision",
    "text": "Describe this screenshot briefly",
    "image_paths": ["/absolute/path/to/image.png"]
  }
}
```

or:

```json
{
  "tool": "omni_run",
  "input": {
    "model": "qwen3-vl:4b",
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

1. Call `omni_inspect` with `task: "vision"` and the available `image_paths` or `images_b64`.
2. Decide the final model from `models`, `recommended_models`, and `hardware`.
3. Call `omni_run`.
4. If it fails, report that failure and stop.
5. Summarize the result for the user.

### Example 1b: Telegram OCR

1. The user sends a screenshot in Telegram and asks to read the text.
2. If the runtime provides a local attachment path, call `omni_inspect` with `image_paths`.
3. Choose one allowed local vision or OCR-capable model from `models` or `recommended_models`.
4. Call `omni_run` with the same `image_paths`.
5. Return the OCR result. Do not ask the user to convert the image manually.

### Example 2: Image generation

1. Call `omni_inspect` with `task: "image_generation"`.
2. If there is no allowed image-generation model, tell the user directly.
3. Otherwise choose the final image-generation model yourself, then call `omni_run`.
4. If `diagnostics.errors` contains a runtime error, surface that as an environment/model failure, not as a plugin failure, and do not retry another model.

### Example 3: Simple chat

If the main model can answer directly, do not call the plugin.

Only call `omni_inspect` + `omni_run` when the user explicitly wants local Ollama execution or when local execution adds capability that the main model does not have.

## Never Do This

- Do not tell the user to send base64 manually when an attachment already exists.
- Do not ask the user for a file path when the runtime has already downloaded the image.
- Do not say the image cannot be passed to the model before attempting `omni_inspect` or `omni_run` with `image_paths` or `images_b64`.
- Do not ignore local attachment inputs and then blame the channel.
