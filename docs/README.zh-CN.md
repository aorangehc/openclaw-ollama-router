# OpenClaw Omni Router

> 面向 OpenClaw 的 Ollama 多模态路由插件，支持资源感知与语音上下文

[![npm version](https://img.shields.io/npm/v/openclaw-omni-router.svg)](https://www.npmjs.com/package/openclaw-omni-router)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Test](https://github.com/aorangehc/openclaw-omni-router/actions/workflows/test.yml/badge.svg)](https://github.com/aorangehc/openclaw-omni-router/actions)

[English](../README.md) | 中文

## 概述

OpenClaw Omni Router 会根据任务类型、模型能力、运行中模型和系统内存情况，为请求挑选更合适的 Ollama 模型，并补充语音输入上下文：

- 文本对话、视觉理解、图像生成统一通过 `omni_route` 路由
- 支持从 `tools.media.audio` 传入的 transcript 作为真实用户输入
- 在资源紧张时降低大模型优先级，减少 OOM
- 当语音消息没有 transcript 时，直接返回清晰提示，而不是盲目调用模型

## 安装

```bash
npm install openclaw-omni-router
```

本地开发也可以使用：

```bash
npm link
npm link openclaw-omni-router
```

## 插件配置

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
  ],
  "skills": ["omni-router"]
}
```

## 语音输入

如果你希望语音消息自动变成文本请求，需要在 OpenClaw 中启用 `tools.media.audio`。

### 本地 CLI 转写

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

### 云端转写

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

## 语音输出

语音回复仍由 OpenClaw 的 `messages.tts` 控制：

```json
{
  "messages": {
    "tts": {
      "auto": "inbound"
    }
  }
}
```

如果使用 `tagged` 模式，则需要上层 agent 在回复中附加 `[[tts]]`。

## 工具

### `omni_route`

输入：

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

输出：

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
      channel?: string,
      note?: string
    },
    errors?: any[],
    timings?: Record<string, number>
  }
}
```

## 行为说明

- 如果 `context.transcript` 存在，插件会优先使用 transcript，而不是 `text`
- 如果 `hasAudio = true` 但没有 transcript，也没有文本输入，插件会返回提示用户启用转写
- 图片生成模型能力通过模型 family/name 做保守识别，再尝试调用兼容端点
- 在高拥塞或低内存时，大模型会被下调到后面的候选位

## Skill

项目自带 skill：[`skills/omni-router/SKILL.md`](../skills/omni-router/SKILL.md)

## 开发

```bash
npm run build
npm test
npm run typecheck
npm run lint
```

## 相关链接

- [Ollama](https://ollama.com/)
- [OpenClaw](https://github.com/openclaw-ollama)
- [Ollama API Documentation](https://github.com/ollama/ollama/blob/main/docs/api.md)

## License

MIT
