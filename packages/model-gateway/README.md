# `@educanvas/model-gateway`

`model-gateway` 是 `TurnModelGateway` 的供应商适配层。它只负责把
OpenAI-compatible Chat Completions + SSE 协议映射为 `teaching-core` 的稳定事件，
不承载教学编排、数据库事务、HTTP Route 或 UI 状态。

## 边界

- 输入：`StreamTurnTextRequest`，只含任务/模型别名、消息、受控工具和审计字段。
- 输出：`text_delta`、`tool_call`、`usage` 以及唯一的 `completed | failed` 终态。
- 不输出供应商原始 chunk、错误正文、API Key 或 `reasoning_content`。
- synthesis 完全根据 `toolResults` 重建 `assistant.tool_calls` 和 `role=tool` 消息，
  不依赖 Gateway 进程内记忆。
- 通过 `AbortSignal` 和内部 deadline 取消 fetch；异常响应会主动释放 body。

实现使用原生 `fetch` + WHATWG Stream，而不是把供应商 SDK 类型带入领域层。

## 配置闸门

配置必须由组合根显式传给 `parseModelGatewayConfiguration(environment)`；包本身不读取
`process.env`。完整变量见仓库根目录 `.env.example`。

- 未配置 `MODEL_GATEWAY_PROVIDER` 时返回 disabled，不静默回退脚本回答。
- 一旦配置真实 Provider，必须显式声明 `EDUCANVAS_DEPLOYMENT_ENV`，避免部署误落入 local 策略。
- 模型 ID 必须由环境变量显式给出，代码没有供应商型号默认值。
- DeepSeek 在 local/development/shared-dev/test 默认关闭，只有
  `MODEL_GATEWAY_ALLOW_DEEPSEEK=true` 才启用。
- DeepSeek 在 staging/production 无条件硬拒绝。
- production 的通用 OpenAI-compatible endpoint 必须使用 HTTPS。

公开组合入口：

```ts
const gateway = createTurnModelGatewayFromEnvironment(environment);
```

返回 `null` 代表该环境未启用真实模型；调用方应明确进入 unavailable 状态。

## DeepSeek 协议说明

截至 2026-07，DeepSeek 官方文档列出的当前候选型号为
`deepseek-v4-flash` 与 `deepseek-v4-pro`；它们只作为部署配置候选，不写成代码默认值。
旧 `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 停止服务。配置前应再次核对
[官方模型公告](https://api-docs.deepseek.com/news/news260424/) 与
[Chat Completion 协议](https://api-docs.deepseek.com/api/create-chat-completion/)。

DeepSeek thinking 工具调用需要回放 `reasoning_content`，但 EduCanvas 明确不保留或转发
CoT。因此该适配器对 DeepSeek 请求固定发送 `thinking: { type: "disabled" }`，并忽略
响应中意外出现的 `reasoning_content`。参考
[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) 与
[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)。

## 验证

```bash
pnpm --filter @educanvas/model-gateway run typecheck
pnpm --filter @educanvas/model-gateway run test
```

Fixture 覆盖任意网络分片、首 delta 先于终态、工具参数增量、usage 尾块、Abort、超时、
429、内容过滤、畸形 SSE、响应 body 释放与 secret/CoT 不外泄。
