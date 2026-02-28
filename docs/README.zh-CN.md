# OpenClaw Ollama 智能路由器

> 具有资源感知能力的 OpenClaw Ollama 模型路由插件

[![npm version](https://img.shields.io/npm/v/openclaw-ollama-router.svg)](https://www.npmjs.com/package/openclaw-ollama-router)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Test](https://github.com/aorangehc/openclaw-ollama-router/actions/workflows/test.yml/badge.svg)](https://github.com/aorangehc/openclaw-ollama-router/actions)

[English](../README.md) | 中文

## 概述

OpenClaw Ollama 路由器是一个插件，能够根据以下因素自动将任务路由到最合适的 Ollama 模型：

- **任务类型**: 对话、视觉、图像生成
- **模型能力**: 从模型信息中自动检测
- **可用资源**: VRAM、RAM、运行中的模型
- **用户偏好**: 速度优先还是质量优先

## 功能特性

- **自动模型发现**: 列出本地所有可用的 Ollama 模型，无需下载
- **能力检测**: 自动从模型家族/名称检测视觉支持
- **资源感知**: 监控 VRAM 和系统内存以避免 OOM
- **智能路由**: 根据任务和资源选择最佳模型
- **自动回退**: 如果模型失败，自动尝试下一个候选
- **跨平台**: 支持 Windows、macOS 和 Linux
- **零外部依赖**: 使用原生 `fetch` 进行 HTTP 请求

## 安装

### 从源码安装（开发）

```bash
# 克隆或进入插件目录
cd /path/to/openclaw-ollama-router

# 安装依赖
npm install

# 构建插件
npm run build
```

### 链接到 OpenClaw（本地开发）

```bash
# 在插件目录中
npm link

# 在你的 OpenClaw 项目中
npm link openclaw-ollama-router

# 或使用本地路径
npm install /path/to/openclaw-ollama-router
```

### 生产环境安装

```bash
npm install openclaw-ollama-router
```

## 配置

将插件添加到你的 OpenClaw 配置中：

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

### 配置选项

| 选项 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `baseUrl` | string | `http://127.0.0.1:11434` | Ollama API 基础 URL |
| `allowedModels` | string[] | `[]` | 模型名称白名单，空 = 所有模型 |
| `defaultPreference` | `"speed"` \| `"quality"` | `"speed"` | 默认模型偏好 |
| `defaultKeepAlive` | number \| string | `0` | 默认保活时间（秒） |
| `requestTimeout` | number | `120000` | 请求超时（毫秒） |

## 使用方法

### 工具: `ollama_route`

用于将请求路由到 Ollama 模型的主要工具。

#### 输入 schema

```typescript
{
  task: "auto" | "chat" | "vision" | "image_generation",
  text?: string,                    // 文本提示
  images_b64?: string[],             // 视觉任务的 base64 图片
  preference?: "speed" | "quality", // 模型偏好
  max_retries?: number,             // 回退尝试次数（默认: 3）
  keep_alive?: number | string      // 保持模型加载（默认: 0）
}
```

#### 输出 schema

```typescript
{
  chosen_model: string,             // 选中的模型
  task: string,                     // 解析后的任务类型
  text?: string,                    // 响应文本
  image_b64?: string,               // 生成的图片
  diagnostics: {
    candidates_tried: string[],     // 尝试过的模型
    errors?: any[],                 // 遇到的错误
    timings?: Record<string, number> // 性能指标
  }
}
```

### 示例

#### 视觉任务

```json
{
  "tool": "ollama_route",
  "input": {
    "task": "vision",
    "text": "这张图片里有什么？",
    "images_b64": ["base64..."]
  }
}
```

#### 图像生成

```json
{
  "tool": "ollama_route",
  "input": {
    "task": "image_generation",
    "text": "一座未来风格的城市"
  }
}
```

#### 对话（质量优先）

```json
{
  "tool": "ollama_route",
  "input": {
    "task": "auto",
    "text": "解释量子计算",
    "preference": "quality"
  }
}
```

## Skill

插件包含一个 skill（`ollama-smart-router`），用于指示主模型何时使用路由工具。详见 [../skills/ollama-smart-router/SKILL.md](../skills/ollama-smart-router/SKILL.md)。

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 运行测试
npm test

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

## 测试

### 单元测试

```bash
npm test
```

### 集成测试

要运行集成测试，请确保 Ollama 正在运行：

```bash
# 启动 Ollama（如未运行）
ollama serve

# 运行测试
npm test
```

## 故障排除

### Ollama 未运行

```
Error: connect ECONNREFUSED 127.0.0.1:11434
```

**解决方案**: 使用 `ollama serve` 启动 Ollama

### 没有可用模型

```
Error: No suitable models found
```

**解决方案**: 使用 `ollama pull <model-name>` 安装模型

### 内存不足

路由器会自动处理：
1. 通过 `/api/ps` 检测运行中的模型
2. 在内存压力下优先选择较小的模型
3. 在 OOM 错误时回退到较小的模型

### 模型不支持视觉

如果视觉任务失败：
- 确保你有支持视觉的模型（如 `llava`、`llama3-vision`）
- 路由器会自动尝试其他模型

## 架构

```
src/
├── index.ts           # 入口文件
├── handler.ts        # 工具处理器 (ollama_route)
├── types/           # TypeScript 类型定义
├── ollama/
│   └── client.ts    # Ollama HTTP 客户端
└── router/
    └── chooseModel.ts # 模型选择逻辑
```

## 跨平台说明

- 使用原生 `fetch`（Node.js 18+）
- 使用 `os` 模块获取系统信息
- 无平台特定依赖
- 支持 Windows、macOS、Linux

## 相关链接

- [Ollama](https://ollama.com/) - 本地 LLM 运行时
- [OpenClaw](https://github.com/aorangehc/openclaw-ollama-router) - AI Agent 框架
- [Ollama API 文档](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [OpenAI 兼容端点](https://github.com/ollama/ollama/blob/main/docs/openai.md)

## License

MIT
