# `@educanvas/gateway`

EduCanvas 云端控制平面组合根。

当前提供：

- `GET /healthz`：不暴露数据库、凭据或用户状态的健康检查；
- `POST /v1/internal/envelopes`：Web 迁移期 BFF 使用的受保护 NDJSON 事件入口；
- `GET /v1/internal/operations/:id/events?after=N`：受保护的 Actor 级事件恢复。

内部入口只有配置至少 32 字节的 `EDUCANVAS_GATEWAY_INTERNAL_TOKEN` 后才启用；未配置时健康检查仍可用，但消息入口诚实返回 `503`。

Gateway Turn Runner 已迁入唯一 `TurnApplicationService`：Gateway 解析的 Actor/Agent/Notebook/Conversation 和同一个 `traceId` 进入统一 Context Snapshot、Model Run、Loop 与消息终态链路；Turn Application 只结算消息，Gateway Event 循环独占 Operation 终态。取消请求先持久化再触发进程内中止。当前 Gateway Profile 仍不暴露 Tool，Asset 输入明确返回 `CAPABILITY_UNAVAILABLE`；它们必须在复用 Web 通用能力的后续纵切接通，不能伪装成已完成。
