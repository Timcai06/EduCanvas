# ADR-0021：模型能力独立 Provider 与继承规则

- 状态：`accepted`
- 日期：2026-08-01
- 负责人：@Timcai06
- 相关决策：[ADR-0017](0017-文本与视觉提供商分离与图片输入路由.md)

## 背景

当前 EduCanvas 的文本配置以主 Provider 为核心，Vision 通过 ADR-0017 使用独立配置；Speech、Transcription、Image 和 Embedding 虽有各自 model alias 与 Gateway Port，Provider 解析和组合仍依赖主配置及 openai-compatible 能力。每项媒体能力需要能够选择独立供应商、模型和端点。

当前限制：

- `packages/model-gateway/src/config/config.ts` 已有主配置、Vision 配置和媒体 model alias，但没有统一的媒体 Provider override；
- Speech/Transcription/Image/Embedding 仍受主 Provider 和 openai-compatible 限制；
- Vision 是唯一通过独立配置变量实现的 Provider 分离。

## 决定

### 1. 目标能力列表

| 能力          | taskAlias                      | modelAlias                        | 当前状态                   |
| ------------- | ------------------------------ | --------------------------------- | -------------------------- |
| text          | `agent.turn` / `teaching.turn` | `primary` / `fast` / `structured` | 已实现                     |
| vision        | （通过 asset-context 路由）    | `primary`（视觉链路）             | ADR-0017 已实现            |
| speech        | `speech.generate`              | `speech`                          | 已实现，受主 Provider 限制 |
| transcription | `audio.transcribe`             | `transcription`                   | 已实现，一次性接口         |
| image         | `image.generate`               | `image`                           | 已实现，受主 Provider 限制 |
| embedding     | `retrieval.embed`              | `embedding`                       | 已实现，受主 Provider 限制 |

### 2. Per-Capability Override 规则

每项能力可以显式配置独立 Provider、Base URL、API Key 和模型：

- 未配置时按明确规则继承主 Provider；
- 能力不兼容时必须关闭，不能错误继承；
- 继承链：`能力 Provider → 主 Provider → 配置缺失时关闭`。

### 3. 配置命名规范

```
MODEL_GATEWAY_<CAPABILITY>_PROVIDER=<provider>
MODEL_GATEWAY_<CAPABILITY>_MODEL=<model-id>
MODEL_GATEWAY_<CAPABILITY>_BASE_URL=<url>
MODEL_GATEWAY_<CAPABILITY>_API_KEY=<key>
MODEL_GATEWAY_<CAPABILITY>_TIMEOUT_MS=<ms>
```

其中 `<CAPABILITY>` 为 `SPEECH`、`TRANSCRIPTION`、`IMAGE`、`EMBEDDING` 等大写能力名。

能力 override 必须作为一致配置组解析：

- 未设置 capability provider 时，只有主 Provider 明确支持该能力才允许整组继承；
- 一旦设置 capability provider，Provider、模型、Base URL 与 Credential 必须共同通过该 Provider 的配置校验；
- 不得把不同 Provider 的 Base URL 或 API Key 拼成一个隐式混合配置；
- 输出 Token、音频字符数、图像尺寸、向量维度等能力专属上限继续使用各自契约，不伪装成通用字段；
- 缺字段或能力不兼容时只关闭该能力，不拖垮文本 Agent。

### 4. 与 ADR-0017 的关系

ADR-0017 的 Vision Provider 配置继续有效，但纳入统一的 per-capability 框架：

- `MODEL_GATEWAY_VISION_MODEL` / `_BASE_URL` / `_API_KEY` 保持不变；
- 新增能力使用相同模式，不为每个能力创建特例。

## 当前实现与目标状态

| 能力            | 当前状态                 | 目标状态                 |
| --------------- | ------------------------ | ------------------------ |
| text (primary)  | 已实现                   | 保持                     |
| vision          | ADR-0017 已实现          | 纳入统一框架             |
| speech          | 受主 Provider 限制       | 独立 Provider 配置       |
| transcription   | 受主 Provider 限制       | 独立 Provider 配置       |
| image           | 受主 Provider 限制       | 独立 Provider 配置       |
| embedding       | 受主 Provider 限制       | 独立 Provider 配置       |
| 配置解析        | 仅 vision 有独立解析     | 统一 per-capability 解析 |
| Worker/Web 组合 | 仅 vision 有路由         | 统一按能力路由           |
| env 文档        | 分散                     | 统一配置参考             |
| 测试            | 仅 vision 有 parity 测试 | 每个能力有配置测试       |

## 禁止

- 不得把 accepted 架构决策写成已经实现；
- 不得为教育场景复制第二套检索基础设施；
- 不得把项目路线图中的未来能力描述成当前 Capability。

## 验证方式

- 配置解析器支持所有能力的独立/继承/关闭语义；
- 每个能力有配置测试覆盖完整/部分/缺失场景；
- env-check 输出包含所有能力的配置状态；
- 文档统一记录配置参考和继承规则。
