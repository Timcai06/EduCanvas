# @educanvas/model-gateway

## 这个包是什么

`model-gateway` 是供应商适配层。它把 OpenAI-compatible Chat Completions、结构化JSON与`/audio/speech`映射为 `@educanvas/agent-core` 的稳定Port，不承载垂直Agent编排、数据库事务、HTTP Route、业务重试或 UI 状态。

Turn 默认使用原生 `fetch` + WHATWG Stream；可显式切到 AI SDK Adapter。两种实现都
终止在同一个 `TurnModelGateway` Port，供应商 SDK 类型不会进入领域层。

## 模块边界

- `openai-compatible-protocol.ts` 只负责未知供应商 JSON 的校验、请求投影、usage、错误与终止原因映射；
- `openai-compatible-turn-model-gateway.ts` 只负责原生网络调用、SSE 生命周期、取消和稳定事件输出；
- `ai-sdk-protocol.ts`、`ai-sdk-turn-model-gateway.ts` 与`ai-sdk-provider-factory.ts`
  分别负责SDK消息/事件投影、流生命周期和Provider构造；
- `turn-model-gateway-factory.ts` 是组合根唯一公共工厂，负责配置解析和 Adapter 选择；
- 测试按文本流、工具流、失败/工厂与共享 fixture 拆分，避免单个测试文件掩盖协议职责。

`tooling/runtime-module-size-boundary.test.mjs` 对该包全部 TypeScript 文件递归执行
400 行可读性门禁。新增 Provider 或 SDK Adapter 必须新建独立模块，不得把协议、网络、
配置选择和测试重新堆回同一文件。

## 协议边界

- 输入为 `StreamAgentTextRequest`：任务/模型别名、阶段、消息、受控工具、工具结果、Trace 和取消信号；
- 输出为 `text_delta`、增量 `tool_call`、`usage`，以及唯一的 `completed | failed` 终态；
- 不输出供应商原始 chunk、错误正文、API Key 或 `reasoning_content`；
- synthesis 根据显式 `toolResults` 重建 `assistant.tool_calls` 和 `role=tool` 消息，不依赖 Gateway 进程内记忆；
- 通过 `AbortSignal` 和内部 deadline 取消 fetch，异常响应会主动释放 body。
- `SpeechModelGateway`只返回`audio/mpeg`字节与安全审计metadata；最多3500字符、
  20 MiB，且不在Adapter内自动重试。

## 配置闸门

配置由组合根显式传给 `parseModelGatewayConfiguration(environment)`；包本身不读取 `process.env`。完整变量见仓库根目录 `.env.example`。

- 未配置 `MODEL_GATEWAY_PROVIDER` 时返回 disabled，不静默回退脚本回答；
- `MODEL_GATEWAY_RUNTIME`只接受`native | ai-sdk`，缺省为`native`；运行期不会在两者之间静默fallback；
- 一旦启用真实 Provider，必须显式声明 `EDUCANVAS_DEPLOYMENT_ENV`；
- 模型 ID 必须由环境变量显式给出，代码没有供应商型号默认值；
- TTS需显式配置`MODEL_GATEWAY_SPEECH_MODEL`；voice缺省`alloy`且可由
  `MODEL_GATEWAY_SPEECH_VOICE`覆盖；DeepSeek配置禁止声明speech alias；
- 当前支持 `openai-compatible` 和受部署策略约束的 `deepseek`；
- DeepSeek 默认关闭，必须显式设置 `MODEL_GATEWAY_ALLOW_DEEPSEEK=true`，且 staging/production 无条件拒绝；
- staging/production 的通用 OpenAI-compatible endpoint 必须使用 HTTPS；DeepSeek endpoint 还必须匹配代码允许的官方主机；
- DeepSeek 请求固定禁用 thinking，响应中的意外 `reasoning_content` 会被忽略，避免保留或转发 CoT。

公共工厂：

```ts
const gateway = createTurnModelGatewayFromEnvironment(environment);
```

返回 `null` 表示该环境未启用真实模型，调用方必须进入明确 unavailable 状态。

## 当前接线状态

Gateway与Web组合根都通过公共工厂选择Turn Adapter，再把稳定Port交给唯一
`TurnApplicationService + AgentLoopEngine`；Worker的结构化与语音任务继续使用原生专用
Adapter。这里的“真实”表示生产代码使用网络Provider，而不是测试Gateway；是否能实际回答
仍取决于部署环境、Endpoint、Key和模型配置，仓库内协议Fixture不能替代live smoke。

## 验证

```bash
pnpm --filter @educanvas/model-gateway typecheck
pnpm --filter @educanvas/model-gateway test
```

Fixture 覆盖网络任意分片、首delta、工具参数增量、usage尾块、Abort、超时、429、内容过滤、
畸形SSE、响应body释放与secret/CoT不外泄；golden parity还覆盖native/AI SDK文本、工具圈、
取消、错误、唯一终态、alias模型解析、最大输出和DeepSeek thinking闸门。
