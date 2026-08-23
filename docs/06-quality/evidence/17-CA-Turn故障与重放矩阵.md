# CA Turn 故障与重放矩阵

- 范围：CX01；CA06 Desktop 不在本轮
- 基线：`49dcbe89902e57fc1753f9caa2b9514ea06f5245`
- CA02 实现提交：`ae40ffc938e62097d672daa0564a3c86af0a00f7`
- 结论边界：本文记录工程证据；唯一 reviewer 已在联合候选完成最终 PASS，外部证据仍不在本表覆盖范围

## 证据语义

| 标记                        | 含义                                                                              |
| --------------------------- | --------------------------------------------------------------------------------- |
| `LOCAL_VERIFIED`            | 本 CA 工作树已执行且退出码为 0                                                    |
| `IMPLEMENTED_PENDING_LEASE` | 故障注入或断言已实现，但 PostgreSQL、Playwright 或固定端口 lease 尚未授权，未执行 |
| `EXTERNAL_PENDING`          | 只能由远端 CI、真实 Provider、真实浏览器/麦克风或人工验收补证                     |

`skip` 不等于通过；`IMPLEMENTED_PENDING_LEASE` 和 `EXTERNAL_PENDING` 都不得被汇总成已覆盖。

## 故障矩阵

| 场景                     | 注入点或输入                                                     | 必须保持的事实                                                                            | 证据                                                                                                                                                                   | 当前状态                                              |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 模型失败                 | Turn Application 收到 `MODEL_FAILED`、限流或 Provider 抛错       | 稳定公开失败码；`retryable` 穿过 lifecycle；不得伪造 completed                            | `packages/agent-runtime/src/turn-application.core.test.ts`、`turn-application.consistency.test.ts`、`packages/gateway-runtime/src/turn-application-projection.test.ts` | `LOCAL_VERIFIED`                                      |
| Provider 不可信输入      | 畸形响应、未知失败码、带 secret/raw body 的异常                  | schema fail closed；浏览器与 terminal intent 不含 Prompt、raw body、key、stack            | `packages/model-gateway/src/ai-sdk/ai-sdk-turn-model-gateway.test.ts`（既有边界）；`packages/db/src/gateway/terminal-reconciliation.test.ts`（闭合 codec）             | `LOCAL_VERIFIED`；真实 Provider 为 `EXTERNAL_PENDING` |
| 工具失败                 | prepare/execute/approval/result 失败或重放                       | 一次 effect；审批与失败语义不互换；terminal recovery 不执行工具                           | `packages/agent-runtime/src/turn-application.tools.test.ts`、`packages/agent-runtime/src/tool-kernel/execution.test.ts`；DB effect ledger integration                  | `LOCAL_VERIFIED`                                      |
| DB 消息事务失败          | assistant、引用或 intent 同事务任一步失败                        | 整个消息事务回滚；Gateway 不对外伪成功；无半份引用                                        | `packages/db/src/platform-conversation.integration.test.ts`                                                                                                            | `LOCAL_VERIFIED`                                      |
| terminal append 前崩溃   | assistant/引用/intent 已提交，operation 仍 running               | 新 Store 在 operation event 锁下补恰一 terminal；正文和引用不重写                         | `platform-conversation.integration.test.ts` 的 completed/failed/cancelled 表驱动用例                                                                                   | `LOCAL_VERIFIED`                                      |
| terminal append 响应丢失 | event 与 operation 已提交，但调用方收到异常                      | Gateway 从持久事件恢复；不得用 generic failure 覆盖，不重跑 runner                        | `packages/gateway-runtime/src/gateway-service.test.ts`                                                                                                                 | `LOCAL_VERIFIED`                                      |
| SSE/游标恢复             | 客户端断流后以 `afterSequence` resume                            | 只回放持久事件；`message.started` 标记 replay；不进入模型/工具循环                        | `packages/gateway-runtime/src/gateway-service.test.ts`、Web projection stream tests；浏览器 reconnect                                                                  | `LOCAL_VERIFIED`                                      |
| 重复提交                 | 相同 idempotency key + 相同 fingerprint                          | replay 既有事件；terminal、引用与 effect 均不重复                                         | `gateway-service.test.ts`；`platform-conversation.integration.test.ts`                                                                                                 | `LOCAL_VERIFIED`                                      |
| 冲突重复                 | 相同 idempotency key + 不同 fingerprint，或不同 terminal payload | 稳定冲突，禁止最后写入者覆盖                                                              | `gateway-service.test.ts`、`platform-conversation.integration.test.ts`                                                                                                 | `LOCAL_VERIFIED`                                      |
| 取消竞速                 | 取消 event 先于 lifecycle assistant settlement                   | 仅空正文 failed/cancelled 可反向补齐；partial content 和 event-only completed fail closed | `platform-conversation.integration.test.ts`                                                                                                                            | `LOCAL_VERIFIED`                                      |
| 进程重启                 | 新建 Store 后 begin/listEvents 同一 operation                    | 先 reconciliation 后 replay；模型、工具、Artifact 副作用计数不增加                        | `platform-conversation.integration.test.ts`                                                                                                                            | `LOCAL_VERIFIED`                                      |
| 未登录                   | Web Turn API 无有效 session                                      | 返回稳定 401，不创建 operation，不包含内部异常                                            | `apps/web/app/api/v1/chat/turn/route.test.ts`、`learn/turn/route.test.ts`                                                                                              | `LOCAL_VERIFIED`                                      |
| 错主体/跨 Notebook       | actor 与 operation/membership 不匹配                             | 404/拒绝；授权预检在 event lock 前，锁内再次复核                                          | `apps/gateway/src/server.test.ts`、`packages/db/src/gateway-identity-route.integration.test.ts`                                                                        | `LOCAL_VERIFIED`                                      |

## 收敛不变量

1. Gateway 附着事实来自持久化的 `gatewayEnvelopeId`，不是调用者自报；附着 Turn 省略 Gateway writer 时 fail closed。
2. lifecycle 只把公开 status、assistant message ID、公开 Gateway failure code 与 `retryable` 编入 intent。正文、Prompt、Provider body、工具参数、secret、stack 均不进入 intent。
3. intent 与 assistant/引用同事务；terminal event 与 Operation 状态同事务。reconciliation 只连接这两组持久事实，不调用 Provider、Tool 或 Artifact Job。
4. operation 级 advisory lock 串行化 append 与 reconciliation；相同 terminal 返回已有事件，不同 terminal 拒绝。
5. event-only completed 不足以证明正文完成；event-only failed/cancelled 也不能把 partial streaming content 升格为最终正文。
6. resume、重复请求和重启必须读取同一 operation ledger，不得以 retry、sleep 或重新运行 Agent Loop 掩盖分叉。

## 最终补证与剩余边界

- PostgreSQL lease 已执行：联合候选 DB 51 files / 366 tests、Worker 12 files / 54 tests 通过。
- Playwright/fixed-port lease 已执行：最终集成候选 Desktop Chromium 50/50 通过；按项目负责人指示
  没有在该候选重跑移动 Chromium 与 Firefox。
- 远端/外部仍待补：full/nightly 独立运行、真实 Provider containment、Chrome/Safari 麦克风验收；
  这些不由本地 fake 代替。

## 本地执行记录

2026-08-12 使用仓库要求的 Node `24.18.0` 执行、不占共享端口的聚焦矩阵：

- Agent model/tool/replay/cancel：5 files，17 tests；
- Gateway terminal/replay/projection：3 files，21 tests；
- Provider schema/secret containment：2 files，25 tests；
- Web unauthenticated Turn 与 stream projection：3 files，22 tests；
- CA02 terminal intent codec/lifecycle/ack-loss 聚焦集：39 tests；
- Agent Runtime、DB、Web、Gateway Runtime、Gateway App typecheck 均退出 0。

上述数字允许重叠文件，只用于定位 CA02 初始命令证据，不应相加宣称全仓覆盖。后续 PostgreSQL
与浏览器补证由[RM/CA 最终集成交付与结档证据](22-RM-CA最终集成交付与结档证据.md)统一冻结。
