# OpenClaw Omni Router

> 让 OpenClaw 主模型先查看本地 Ollama 能力，再自己选择模型执行的插件。

[English](../README.md) | 中文

## 概述

这个插件现在提供三个工具：

- `omni_inspect`：把本地 Ollama 模型列表、运行中模型、系统内存和可用 GPU 信息暴露给主模型
- `omni_run`：按主模型指定的模型名直接执行
- `omni_route`：兼容旧工作流，继续支持“一步路由并执行”

推荐链路：

1. 主模型先判断自己能不能直接回答。
2. 如果需要本地多模态/本地模型能力，就调用 `omni_inspect`。
3. 主模型根据 `recommended_models`、`models` 和硬件信息决定用哪个模型。
4. 主模型调用 `omni_run`。
5. 主模型读取工具返回结果，再组织给用户。

## 安装

```bash
npm install
npm run build
npm run install:openclaw
```

等价命令：

```bash
openclaw plugins install /absolute/path/to/openclaw-ollama-router --link
```

## 卸载

```bash
npm run uninstall:openclaw
```

等价命令：

```bash
openclaw plugins uninstall openclaw-omni-router --force --keep-files
```

这里默认带 `--keep-files`，适合你现在这种 `--link` 安装方式，只会把 OpenClaw 里的安装记录和配置移除，不会删除当前仓库目录。

## 插件配置

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

说明：

- `allowedModels` 为空时会扫描所有本地 Ollama 模型
- `allowedModels` 不为空时，`omni_run` 和 `omni_route` 只允许执行白名单里的模型
- `defaultPreference` 会影响 `omni_inspect` 的推荐顺序和 `omni_route` 的路由顺序

## 工具说明

### `omni_inspect`

用于“让主模型先做判断”。

输入：

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

输出重点：

- `task`：解析后的真实任务类型
- `hardware`：系统内存、CPU 数量、NVIDIA GPU 显存快照
- `models`：本地模型列表，以及 `allowed`、`supportsResolvedTask`、运行中状态、能力推断
- `recommended_models`：旧路由器按当前策略给出的推荐顺序

### `omni_run`

用于“主模型已经决定好要跑哪个 Ollama 模型”。

输入：

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

输出重点：

- `chosen_model`
- `task`
- `text` 或 `image_b64`
- `diagnostics.errors` 中的真实 Ollama 运行错误

### `omni_route`

兼容旧逻辑，内部仍然是“看模型 -> 选模型 -> 执行”，适合快速回归测试或保底场景。

## Skill 策略

项目自带的 skill 在 `skills/omni-router/SKILL.md`。

建议策略：

1. 主模型如果能直接答，就不要调用本地工具。
2. 需要本地多模态或本地推理时，先调用 `omni_inspect`。
3. 由主模型结合 `models`、`recommended_models` 和硬件情况自行决定最终模型。
4. 调用 `omni_run`。
5. `omni_route` 只作为兼容或兜底。

## 语音输入

如果要让语音消息自动进入这套流程，需要在 OpenClaw 里启用 `tools.media.audio`。插件本身不做转写，只消费 transcript，并把音频上下文写进 diagnostics。

## 开发与测试

```bash
npm test
npm run build
```

真实 OpenClaw 联调：

```bash
# 旧的一步路由
bash scripts/openclaw-smoke-test.sh chat
bash scripts/openclaw-smoke-test.sh vision
bash scripts/openclaw-smoke-test.sh image_generation

# 新的 inspect -> run 链路
bash scripts/openclaw-smoke-test.sh guided_chat
bash scripts/openclaw-smoke-test.sh guided_vision
bash scripts/openclaw-smoke-test.sh guided_image_generation

# 全部跑一遍
npm run test:openclaw
```

`guided_*` 模式会直接从真实 OpenClaw session log 里提取 `omni_inspect` 和 `omni_run` 的 tool result。

如果是生图任务，插件现在会把 Ollama 的原始错误透传给 OpenClaw；所以 Linux 上即使模型已安装，运行失败时你也能直接看见底层报错，而不是误判成插件问题。
