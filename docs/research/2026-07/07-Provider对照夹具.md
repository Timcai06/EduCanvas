# Provider 对照夹具

- 状态：`verified`
- 适用范围：第二代架构Provider选择与生产回归证据
- 最后验证时间：2026-07-22
- 固定版本：`ai@7.0.34`、`@ai-sdk/openai-compatible@3.0.14`
- 复现入口：`pnpm --filter @educanvas/model-gateway test -- provider-parity.test.ts`

## 一、候选与来源

候选只使用 Vercel 官方 [AI SDK 仓库](https://github.com/vercel/ai)、[streamText API](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)、[Tool Calling 文档](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)与[错误处理文档](https://ai-sdk.dev/docs/ai-sdk-core/error-handling)。生产版本固定在包清单与lockfile，任何升级都必须重跑本夹具和live smoke。

依赖仅存在于`@educanvas/model-gateway`；生产Adapter按协议、流生命周期和Provider工厂拆分，框架导入由依赖边界测试限制在`ai-sdk-*`模块。Gateway与Web只能通过公共工厂得到稳定Port。

## 二、对照边界

同一组 golden fixtures 分别驱动：

1. 现有 `OpenAICompatibleTurnModelGateway`：原生 fetch + SSE；
2. `AiSdkTurnModelGateway`：AI SDK `streamText` + 官方Mock Language Model，并通过OpenAI-compatible工厂做真实请求。

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

生产Adapter继续遵守：

- 固定版本并保留 native Adapter 作为可回滚实现；
- `maxRetries: 0`，重试与唯一终态由 EduCanvas 控制；
- 默认关闭可能记录 Prompt/响应正文的 telemetry；
- 显式过滤 reasoning、provider metadata 和原始错误；
- 对 SDK major/patch 变更复跑本夹具，尤其是 `instructions`、abort 与 tool stream 语义。

当前结论仍是`adapt`而不是替换：`MODEL_GATEWAY_RUNTIME=ai-sdk`才会启用SDK实现，缺省
`native`，运行期不静默fallback。2026-07-22使用同一DeepSeek短请求真实对照，两边均输出
`text_delta → usage → completed`、正文`4`和唯一成功终态；这项手工证据不替代nightly live smoke。
