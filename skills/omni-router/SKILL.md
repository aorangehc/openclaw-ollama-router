---
name: omni-router
description: Automatically route tasks to the best available Ollama model based on task type, system resources, and voice input
trigger: auto
priority: high
---

```json
{
  "skill": "omni-router",
  "version": "1.0.0"
}
```

# Omni Router Skill

This skill instructs the main model (like MiniMax) when and how to use the `omni_route` tool for intelligent model selection, including voice input handling and voice output decisions.

## Trigger Conditions

Use this skill when the user request involves:

1. **Voice/Audio Input**: User sends voice messages or audio files
2. **Image Understanding**: User provides images or screenshots
3. **Image Generation**: User asks to draw, generate, or create images
4. **Text Conversation**: Regular chat or Q&A
5. **Complex Reasoning**: Multi-step reasoning or analysis

## Voice Input Handling

### Detecting Voice Input

Voice input can be detected through:

1. **Transcript Variable**: `{{Transcript}}` is available (provided by `tools.media.audio`)
2. **[Audio] Block**: The message body contains an `[Audio]` block indicating audio was received

When either of these signals is present, treat the audio as transcribed text.

### Handling Transcript

If `{{Transcript}}` is available:

```
User sends voice message → Transcript: "What's the weather today?"
```

**Action**: Use the transcript as the user's actual text input:
- Pass `transcript` in the `context` parameter
- Use `task: "chat"` (or `auto`)
- The response will be text-based

### When Transcript Is NOT Available

If user sends voice but no transcript is available:

**Action**: Prompt user to enable audio transcription:
```
I received your voice message but couldn't transcribe it. Please ensure:
1. tools.media.audio is enabled in your OpenClaw config
2. A local CLI (whisper, whisper-cli, sherpa-onnx-offline) or provider is configured
```

See [Audio Transcription Configuration](#audio-transcription-configuration) below.

## Voice Output (TTS)

### Triggering Voice Output

Voice output is controlled by the `messages.tts.auto` setting in OpenClaw:

| Mode | Behavior |
|------|----------|
| `"inbound"` | Automatically reply with voice when user sends voice |
| `"tagged"` | Only speak when reply contains `[[tts]]` tag |

### Skill Rules for Voice Output

**For `messages.tts.auto = "inbound"`**:
- No special action needed - OpenClaw auto-detects voice input and enables TTS for reply
- Ensure the response text is suitable for speech (natural language, not code-heavy)

**For `messages.tts.auto = "tagged"`**:
- When input has voice (detected via `[Audio]` or `{{Transcript}}`), add `[[tts]]` at the end of the response
- Example response format:
  ```
  The weather today is sunny with a high of 25°C. [[tts]]
  ```

## Tool Usage

### Tool: `omni_route`

#### When to Call

| User Request | task parameter | Notes |
|-------------|----------------|-------|
| User sends images/screenshots | `vision` | Pass images in `images_b64` |
| User asks to "draw", "generate image" | `image_generation` | Pass prompt in `text` |
| Regular conversation | `chat` or `auto` | Pass text in `text` |
| Voice message (with transcript) | `chat` or `auto` | Pass transcript in `text`, set `context.hasAudio: true` |
| Unclear or complex request | `auto` | Let the router decide |

#### Input Parameters

```typescript
{
  task: "auto" | "chat" | "vision" | "image_generation",
  text?: string,                    // Text prompt or conversation
  images_b64?: string[],             // Base64 images for vision tasks
  preference?: "speed" | "quality",  // Model preference (default: "speed")
  max_retries?: number,              // Fallback attempts (default: 3)
  keep_alive?: number | string,      // Model keep-alive in seconds (default: 0)
  context?: {
    hasAudio?: boolean,              // Whether input contains audio
    transcript?: string,            // Transcribed text from audio
    channel?: string                 // Channel: telegram, feishu, discord, etc.
  }
}
```

#### Response Format

```typescript
{
  chosen_model: string,              // Selected model name
  task: string,                      // Resolved task type
  text?: string,                     // Response text (for chat/vision)
  image_b64?: string,                // Generated image (for image_generation)
  diagnostics: {
    candidates_tried: string[],      // Models attempted
    audio: {
      hasAudio: boolean,             // Whether input had audio
      transcript_used: boolean,      // Whether transcript was used
      transcript_len?: number,       // Length of transcript
      note?: string                  // Additional notes
    },
    errors?: any[],                  // Any errors encountered
    timings?: Record<string, number> // Performance metrics
  }
}
```

## Examples

### Example 1: User sends a screenshot
```
User: "What is this error message?"
[User attaches screenshot]
```

**Tool Call**:
```json
{
  "tool": "omni_route",
  "input": {
    "task": "vision",
    "text": "What is this error message?",
    "images_b64": ["screenshot_base64..."],
    "preference": "speed"
  }
}
```

### Example 2: User asks to generate an image
```
User: "Draw a futuristic city"
```

**Tool Call**:
```json
{
  "tool": "omni_route",
  "input": {
    "task": "image_generation",
    "text": "Draw a futuristic city"
  }
}
```

### Example 3: Regular conversation
```
User: "Explain quantum computing"
```

**Tool Call**:
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

### Example 4: Voice message with transcript
```
User: [Voice message]
Transcript: "What's the weather today?"
```

**Tool Call**:
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

**Response** (with TTS for tagged mode):
```
The weather today is sunny with a high of 25°C. [[tts]]
```

### Example 5: Voice message without transcript
```
User: [Voice message - transcription failed or not enabled]
```

**Response**:
```
I received your voice message but couldn't transcribe it. Please ensure tools.media.audio is enabled in your OpenClaw configuration, or try sending a text message instead.

To enable audio transcription, add this to your ~/.openclaw/openclaw.json:

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

### Example 6: Multiple model fallback
If the first model fails, the router automatically tries the next candidate:

```json
{
  "chosen_model": "llama2:13b",
  "diagnostics": {
    "candidates_tried": ["llama2:70b", "llama2:13b"],
    "audio": {
      "hasAudio": false,
      "transcript_used": false
    },
    "errors": [
      { "model": "llama2:70b", "message": "insufficient memory" }
    ]
  }
}
```

## Audio Transcription Configuration

To enable voice input transcription, configure `tools.media.audio` in your OpenClaw config:

### Option 1: Local CLI (Recommended - Privacy/Free)

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
- **whisper.cpp**: `whisper-cli` or `./main -m models/ggml-base.bin -f {{MediaPath}}`
- **sherpa-onnx-offline**: `sherpa-onnx-offline ... {{MediaPath}}`

### Option 2: Provider (Cloud)

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

## TTS Configuration

To enable voice output, configure `messages.tts`:

### Option 1: Auto Inbound (Recommended for Voice Chat)

```json
{
  "messages": {
    "tts": {
      "auto": "inbound"
    }
  }
}
```

This will automatically reply with voice when user sends voice.

### Option 2: Tagged Mode

```json
{
  "messages": {
    "tts": {
      "auto": "tagged"
    }
  }
}
```

This requires `[[tts]]` tag in the response to trigger voice output.

### TTS Provider Options

| Provider | Description | Requires API Key |
|----------|-------------|------------------|
| `edge` | Microsoft Edge TTS (default, no key needed) | No |
| `openai` | OpenAI TTS | Yes |
| `elevenlabs` | ElevenLabs TTS | Yes |
| `custom` | Custom TTS endpoint | Depends |

## Configuration

The skill uses these plugin configuration options:

- `baseUrl`: Ollama server URL (default: `http://127.0.0.1:11434`)
- `allowedModels`: Whitelist of models to use
- `defaultPreference`: Default preference `speed` or `quality`
- `defaultKeepAlive`: Default keep-alive duration in seconds
- `requestTimeout`: Request timeout in milliseconds

## Notes

1. **Automatic Resource Management**: The router automatically uses `keep_alive=0` to release VRAM after each request, unless configured otherwise.

2. **Resource Awareness**: The router considers:
   - Available VRAM (from Ollama `ps` API)
   - System RAM (from Node.js `os` module)
   - Running models (congestion detection)

3. **Graceful Degradation**: If the preferred model fails (OOM, timeout), the router automatically falls back to smaller models.

4. **Vision Support**: Vision models are automatically detected by checking the model family (e.g., `llava`) or name (e.g., `*-vision`).

5. **Voice Processing**: Voice input is handled by OpenClaw's `tools.media.audio`, not by this plugin. The plugin only consumes the transcript and provides voice-aware diagnostics.
