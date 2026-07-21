# Provider 对照夹具

- 状态：`verified`
- 适用范围：第二代架构研究，不是生产 Provider Adapter
- 最后验证时间：2026-07-21
- 固定版本：`ai@7.0.31`
- 复现入口：`pnpm --filter @educanvas/model-gateway test -- provider-parity.test.ts`

## 一、候选与来源

候选只使用 Vercel 官方 [AI SDK 仓库](https://github.com/vercel/ai)、[streamText API](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)、[Tool Calling 文档](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)与[错误处理文档](https://ai-sdk.dev/docs/ai-sdk-core/error-handling)。`ai@7.0.31` 的 npm 元数据显示许可证为 Apache-2.0、Node 要求为 `>=22`；2026-07-21 的 `latest` 是 7.0.32，但本夹具固定 7.0.31，以复现第一轮隔离实验而不在对照中改变变量。

该依赖只位于 `@educanvas/model-gateway` 的 `devDependencies`。候选 Adapter 位于 `src/testing/`，不从 package 公共入口导出，也没有生产调用者。

## 二、对照边界

同一组 golden fixtures 分别驱动：

1. 现有 `OpenAICompatibleTurnModelGateway`：原生 fetch + SSE；
2. `AiSdkResearchTurnModelGateway`：AI SDK `streamText` + 官方 Mock Language Model。

对照的是 EduCanvas `TurnModelGateway` 的语义 transcript，而不是供应商分片的字节边界。两边必须得到相同的文本、完整工具调用、累计 usage 和唯一终态。

## 三、已验证结果

| 场景                             | 结果 | 约束证据                                                                  |
| -------------------------------- | ---- | ------------------------------------------------------------------------- |
| 文本、reasoning、usage、完成终态 | 通过 | reasoning 不出 Adapter；usage 缺失字段归零；completed 只有一次            |
| 工具调用与强制 synthesis         | 通过 | 多圈与强制 synthesis 仍由 `AgentLoopEngine` 拥有，SDK 不自动执行 Tool     |
| synthesis 回注完整 Tool exchange | 通过 | 第二次 SDK prompt 同时包含 assistant tool-call 与 tool-result             |
| 运行中取消                       | 通过 | 两种 Adapter 都输出一次 `aborted / retryable=false`                       |
| 供应商异常含敏感信息             | 通过 | 对外只有稳定 `unavailable`，事件中无原始 message、stack、Prompt 或 secret |
| 流事件与工具参数分片不同         | 通过 | Adapter 收敛为相同 `text_delta / tool_call / usage / terminal` 契约       |

真实执行还发现 AI SDK 7 不允许 `system` message 留在 `messages` 中，必须转换到 `instructions`。这属于 SDK Adapter 的版本差异，不能反向污染 EduCanvas 的稳定请求契约。

## 四、采用判断

实验支持把 AI SDK 作为 `TurnModelGateway` 后的候选 Provider Adapter，但不支持用它接管 Agent Loop、Tool Runtime、Notebook Session、审批或 Operation 终态。

若后续采用，生产 Adapter 至少仍需：

- 固定版本并保留 native Adapter 作为可回滚实现；
- `maxRetries: 0`，重试与唯一终态由 EduCanvas 控制；
- 默认关闭可能记录 Prompt/响应正文的 telemetry；
- 显式过滤 reasoning、provider metadata 和原始错误；
- 对 SDK major/patch 变更复跑本夹具，尤其是 `instructions`、abort 与 tool stream 语义。

当前结论是 `adapt`，不是立即替换。是否进入生产迁移仍由 proposed ADR 与 Code Owner 决定。
