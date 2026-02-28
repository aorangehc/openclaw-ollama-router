---
name: ollama-smart-router
description: Automatically route tasks to the best available Ollama model based on task type and system resources
trigger: auto
priority: high
---

```json
{
  "skill": "ollama-smart-router",
  "version": "1.0.0"
}
```

# Ollama Smart Router Skill

This skill instructs the main model (like MiniMax) when and how to use the `ollama_route` tool for intelligent model selection.

## Trigger Conditions

Use this skill when the user request involves:

1. **Image Understanding**: User provides images or screenshots
2. **Image Generation**: User asks to draw, generate, or create images
3. **Text Conversation**: Regular chat or Q&A
4. **Complex Reasoning**: Multi-step reasoning or analysis

## Tool Usage

### Tool: `ollama_route`

#### When to Call

| User Request | task parameter | Notes |
|-------------|----------------|-------|
| User sends images/screenshots | `vision` | Pass images in `images_b64` |
| User asks to "draw", "generate image" | `image_generation` | Pass prompt in `text` |
| Regular conversation | `chat` or `auto` | Pass text in `text` |
| Unclear or complex request | `auto` | Let the router decide |

#### Input Parameters

```typescript
{
  task: "auto" | "chat" | "vision" | "image_generation",
  text?: string,                    // Text prompt or conversation
  images_b64?: string[],             // Base64 images for vision tasks
  preference?: "speed" | "quality", // Model preference (default: "speed")
  max_retries?: number,             // Fallback attempts (default: 3)
  keep_alive?: number | string      // Model keep-alive in seconds (default: 0)
}
```

#### Response Format

```typescript
{
  chosen_model: string,              // Selected model name
  task: string,                     // Resolved task type
  text?: string,                    // Response text (for chat/vision)
  image_b64?: string,               // Generated image (for image_generation)
  diagnostics: {
    candidates_tried: string[],     // Models attempted
    errors?: any[],                 // Any errors encountered
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
  "tool": "ollama_route",
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
  "tool": "ollama_route",
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
  "tool": "ollama_route",
  "input": {
    "task": "auto",
    "text": "Explain quantum computing",
    "preference": "quality"
  }
}
```

### Example 4: Multiple model fallback
If the first model fails, the router automatically tries the next candidate. The diagnostics show what was attempted:

```json
{
  "chosen_model": "llama2:13b",
  "diagnostics": {
    "candidates_tried": ["llama2:70b", "llama2:13b"],
    "errors": [
      { "model": "llama2:70b", "message": "insufficient memory" }
    ]
  }
}
```

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
