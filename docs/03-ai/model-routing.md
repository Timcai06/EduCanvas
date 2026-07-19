# 模型路由

- 状态：`accepted`
- 相关决策：[ADR-0017](../09-decisions/0017-unified-runtime-and-notebook-context.md)、[ADR-0019](../09-decisions/0019-modular-monolith-artifacts-and-durable-jobs.md)
- 最后验证：2026-07-18

## 当前实现边界

`packages/teaching-core` 已定义供应商无关的模型契约：

- `TaskAlias`：`agent.turn`、`teaching.turn`、`artifact.generate`、`retrieval.query_rewrite`、`speech.generate`；
- `ModelAlias`：`primary`、`fast`、`structured`、`speech`；
- `TurnModelGateway.streamTurnText()`：正常教学 Turn 的唯一模型入口；
- `StructuredModelGateway.generateStructured()`：只允许 Artifact 和非 Turn 结构化任务；
- `SpeechModelGateway.generateSpeech()`：只允许受限文本脚本转`audio/mpeg`二进制；
- `TurnModelEvent`：`text_delta / tool_call / usage / completed / failed`；
- `ProviderCallMetadata` 与 `NormalizedModelError`：用于稳定审计和错误收敛。

当前 `packages/teaching-runtime` 的 `TeachingTurnOrchestrator.streamTurn()` 实现直答一次 `answer`，或 `answer → tools → synthesis` 两次模型运行的兼容边界。它是现状而不是长期架构；统一 Runtime 将以 `TurnBudget` 约束模型运行、工具圈、耗时和资源。`createTeachingTurnAnswerPromptMaterial()` 仍是当前 answer Prompt 的唯一纯构建入口，材料明确排除 Trace、运行期 signal 与 secret。

`packages/model-gateway` 已实现 OpenAI-compatible Turn、结构化 JSON 与`/audio/speech`三个Adapter。语音Adapter只接受`mp3`、最多3500字符、最多20 MiB响应，单次调用不做内部重试；超时、限流与异常响应直接收敛为稳定错误。它不直接读取 `process.env`，环境配置由组合根显式注入。当前仍未实现跨用户日预算、显式 Fallback和nightly live smoke；测试替身不能注册到生产组合根。

## 别名语义

`taskAlias` 表示业务目的，`modelAlias` 表示路由档位，二者不能混用：

| taskAlias                 | 允许调用方式                   | 默认 modelAlias |
| ------------------------- | ------------------------------ | --------------- |
| `teaching.turn`           | 仅 `streamTurnText()`          | `primary`       |
| `artifact.generate`       | 仅受确认后的结构化 operation   | `structured`    |
| `retrieval.query_rewrite` | 非 Turn 结构化辅助任务         | `fast`          |
| `speech.generate`         | 仅`generateSpeech()`二进制输出 | `speech`        |

供应商模型 ID、版本和区域只能出现在服务端路由配置、Provider Adapter 与审计结果中，不能进入教学 runtime、Web 组件、Prompt 业务分支或客户端请求。

## 正常 Turn 调用规则

1. `answer` 阶段可以输出文本或请求工具，不能混合；
2. 直接文本回答只运行一次模型；
3. 工具参数允许以 JSON 字符串分片传输，runtime 在 `done=true` 后统一解析并执行 Schema、状态和 exposure 校验；
4. 工具路径必须把 `callId / tool / 已验证 arguments / 已验证 output` 组成自包含交换传入 `synthesis`，Provider Adapter 不得依赖上一请求的进程内记忆；
5. `synthesis` 不再暴露工具，只生成最终学生可见文本；
6. 当前 `teaching.turn` 最多两次模型运行；迁入统一 Runtime 后由显式 `TurnBudget` 取代固定次数。任何供应商级网络重试仍必须在同一个 model run/attempt 策略内显式审计。

## Provider Adapter 实现选择

首个 Adapter 选择原生 OpenAI-compatible SSE，原因是必须无损保留并严格校验：

- Provider response ID 与 tool call ID；
- Token usage、finish reason、model revision 和 system fingerprint；
- `AbortSignal` 的订阅、传播与上游取消；
- 畸形事件、内容过滤、限流和连接中断的稳定错误映射。

供应商原始 chunk、异常正文、推理内容和 SDK 类型均不得越过 Adapter。未来可以在相同 Port 后增加 AI SDK Adapter，但必须先用同一组官方格式 Fixture 证明上述语义完全等价。

语音输出采用OpenAI-compatible `POST /audio/speech`的非流式`mp3`形态；当前只
解析音频二进制和安全响应头，不把供应商事件或临时URL暴露给业务层。模型ID由
`MODEL_GATEWAY_SPEECH_MODEL`显式配置，voice由
`MODEL_GATEWAY_SPEECH_VOICE`配置；实现依据[OpenAI Audio API](https://platform.openai.com/docs/api-reference/audio/createSpeech)。

## DeepSeek 开发边界

- DeepSeek 在 local/development/shared-dev/test 默认关闭，只有显式设置 `MODEL_GATEWAY_ALLOW_DEEPSEEK=true` 才可处理合成教学问题；staging/production 无条件拒绝；
- 截至 2026-07-15，官方当前候选型号是 `deepseek-v4-flash` 与 `deepseek-v4-pro`；它们只允许写入部署配置，不能作为代码默认值。官方已公告旧 `deepseek-chat`、`deepseek-reasoner` 于 2026-07-24 15:59 UTC 停止服务，配置前需复核[最新模型公告](https://api-docs.deepseek.com/news/news260424/)；
- OpenAI-compatible 流式适配启用 `stream_options.include_usage`，并正确处理末尾 `choices=[]` 的 usage chunk；
- 因 EduCanvas 不保留 CoT，而 DeepSeek thinking 工具调用要求回放 `reasoning_content`，Adapter 固定发送 `thinking: { type: "disabled" }`；响应中意外出现的 `reasoning_content` 仍不转换、不持久化、不记录到日志，也不返回浏览器；
- API Key 只进入服务端 secret，禁止 `NEXT_PUBLIC_*`、仓库 Fixture、日志和截图。

协议依据：[Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)、[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)。

## 配置与剩余治理

- 已实现：环境 allowlist、DeepSeek 生产硬拒绝、显式模型 ID、HTTPS 校验、请求截止时间与取消；
- 已实现（speech）：每个音频任务一次TTS调用、1–8项来源、3500字符输入、
  20 MiB输出上限，无适配器自动重试；字符数、模型、voice与耗时随Artifact版本审计；
- 待实现：跨用户/日并发与成本预算、显式 Fallback；
- 每个 alias 的允许模态、上下文窗口和最大输出约束；
- response ID、解析模型、Prompt 版本、Token、耗时、错误码和结果状态审计；
- 合成输入的手动/nightly live smoke，确定性 CI 继续只用 Fixture。
