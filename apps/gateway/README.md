# `@educanvas/gateway`

EduCanvas 云端控制平面组合根。

当前提供：

- `GET /healthz`：不暴露数据库、凭据或用户状态的健康检查；
- `POST /v1/internal/envelopes`：Web 迁移期 BFF 使用的受保护 NDJSON 事件入口；
- `GET /v1/internal/operations/:id/events?after=N`：受保护的 Actor 级事件恢复。

内部入口只有配置至少 32 字节的 `EDUCANVAS_GATEWAY_INTERNAL_TOKEN` 后才启用；未配置时健康检查仍可用，但消息入口诚实返回 `503`。当前 Turn Runner 也会明确返回 `CAPABILITY_UNAVAILABLE`，直到统一 Agent Runtime 接入，绝不回退到脚本回答。
