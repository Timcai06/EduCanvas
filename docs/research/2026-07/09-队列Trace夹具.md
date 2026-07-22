# 真实队列 Trace 夹具

- 验证日期：2026-07-21
- 结论：`operationId + W3C traceparent` 足以跨 PostgreSQL 队列恢复因果链；业务正文不应进入 span、event、baggage 或 job payload
- 可执行证据：`apps/worker/src/queue-trace.integration.test.ts`

## 问题

第二代架构需要把 client、gateway、model、tool 与 worker 放进同一条可诊断因果链，但不能把学生正文、系统 Prompt、判分键、访问 Token、Provider Secret 或对象存储 key 复制到遥测系统。`operationId` 是 EduCanvas 持久业务关联键，`traceparent` 只是一次调用链的传播上下文；二者不能互相替代。

## 夹具边界

夹具使用真实 `graphile-worker` 与集成测试 PostgreSQL：

1. client 创建根 span；gateway、model、tool 逐级成为子 span；
2. tool 只把 `operationId` 和符合 W3C Trace Context 的 `traceparent` 写入任务 payload；
3. worker 从 payload 提取上下文并建立子 span；
4. In-Memory Exporter 断言五个 span 只有一个 trace id，且父子 span id 连续；
5. span attributes 采用双字段白名单，event 为空，队列 payload 采用 Zod strict schema；
6. 敏感标记和敏感字段名在导出的遥测边界与实际消费 payload 中均为零。

该研究契约现已部分生产化：Turn Trace使用OTLP Adapter、比例采样、有界Batch和Exporter
degraded状态；允许的span属性扩为`operation_id/stage/entrypoint`，静态事件只允许
`context.prepare / approval.required / lifecycle.event.invalid`，其中审批事件最多记录`L0–L3`
risk，不记录capability或参数。跨PostgreSQL continuation的W3C传播仍在独立纵切中，不能把
queue fixture误写成已生产完成。

## 固定契约

| 载体            | 允许字段                                                            | 禁止字段                                                    |
| --------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| Queue payload   | `operationId`、`traceparent`                                        | 正文、Prompt、判分键、Token、Secret、对象 key、任意扩展字段 |
| Span attributes | `educanvas.operation_id`、`educanvas.stage`、`educanvas.entrypoint` | 请求/响应正文和任何 Credential                              |
| Span events     | 三个静态名称；审批只允许`educanvas.risk=L0–L3`                      | capability、工具参数、模型输出、学生答案                    |
| Baggage         | 默认不用                                                            | 所有业务正文与身份凭据                                      |

生产 Adapter 若确需额外维度，必须先进入显式白名单并证明低基数、非个人信息、非秘密；不能把“方便搜索”当作记录正文的理由。

## 依赖事实

- `@opentelemetry/api` 1.9.1，Apache-2.0；只依赖稳定 API。
- `@opentelemetry/sdk-trace-node` 2.10.0与OTLP HTTP Exporter 0.221.0，Apache-2.0；生产依赖只存在于`packages/telemetry`。
- `graphile-worker` 0.16.6 继续承担真实 PostgreSQL 队列传播；本实验没有引入第二任务事实源。

版本与许可证在 2026-07-21 由 npm 官方包元数据复核；能力语义以 OpenTelemetry 官方 Context Propagation 与 W3C Trace Context 文档为准。

## 决策影响

- `adopt` OpenTelemetry API/SDK：Turn Adapter已接入生产组合根，跨进程carrier仍待完成；
- `retain` `operationId` 作为业务审计和恢复键，不让 trace id 成为业务外键；
- `reject` 全量 Prompt/Response capture、把秘密写入 baggage、让 exporter 成为业务事实源；
- 生产接入前仍需定义采样、保留期、租户访问控制、Exporter degraded 行为与数据驻留策略。
