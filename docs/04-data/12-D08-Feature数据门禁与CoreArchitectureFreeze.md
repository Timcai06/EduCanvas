# D08：Feature 数据门禁与 Core Architecture Freeze

- 任务：`D 数据架构与扩展性收敛` → `D08`
- 状态：`PASS`
- 完成时间：2026-08-09（CST）
- 起始基线：`075cbbb5f221cba7e32c1497b4da16a044d37f2b`
- Migration：`0`
- 物理 Schema / shared live 数据变化：`0 / 0`

## 1. 最终结论

D00–D08 已满足完成定义，EduCanvas 进入 **Core Architecture Freeze**。

Freeze 的含义是：没有真实证据，不再进行大范围基础架构重构。它不禁止按产品需求演进；
新长期事实必须填写 Feature Data Contract，新 migration 必须遵守历史不可变、规模/锁/回退、
fresh 和 N-1 纪律。

## 2. Authority

结论：长期事实有明确唯一权威。

- D01 覆盖 67/67 表的 Domain、Role、Authority、Owner、Writer、Reader、Retention、Deletion；
- `learning_events` 是学习事实，`mastery_states` 是可重建投影；
- `conversation_messages` 是平台长期消息权威；`chat_messages` 是 ADR-0013 管理的 K12
  迁移期运行权威，不是无约束的第二套平台消息；
- Model Run、Tool Call、Turn Context Snapshot 已归并为统一生产写入者；旧教学形状只读兼容；
- Graphile Worker 队列表不是业务事实，业务任务状态仍在各领域 ledger；
- `delegated_grants` 等 no-writer 表的状态已在 D01 明确，不以“有表”伪装为已接线产品能力。

## 3. Integrity

结论：核心内部关系由数据库强制，剩余逻辑 ID 均有分类与验证责任。

- head schema 真实 catalog：67 public tables、127 FK、237 CHECK、238 indexes；
- D02 建立：`assets.space_id → spaces.id` restrict、
  `lesson_sessions.student_id → platform_users.id` restrict、
  `turn_usage_budget_outcomes.operation_id → agent_operations.id` cascade；
- fresh→head 新增显式 catalog 回归，独立断言三条 FK delete action 与
  `assets_space_fk_idx`，不依赖有缺口的 0051 snapshot；
- D02 的其余 logical ID 按 compatibility、derived、external 或 polymorphic 分类，
  没有未解释的核心弱关系；
- FK 删除路径和支撑索引继续由 `fk-index-audit.integration.test.ts` 守门。

## 4. Extensibility

结论：新功能默认无需改核心表，开放标识与安全状态已分离。

- D03 审计全部成员型 CHECK：closed lifecycle/security 状态继续 DB 强制；
- capability、asset kind/origin、processor/representation kind 等扩展标识使用稳定格式 CHECK
  - 应用 Registry，不再为新增合法值生成 migration；
- D05 将 schema 单体拆为 identity/workspace/conversation/agent-runtime/asset/artifact/
  knowledge/retrieval/learning 等领域模块，公共 `./schema` 导出保持兼容；
- canonical [数据设计](02-数据设计.md)已写入 Feature Data Contract；若 Authority、Parent、
  Retention、Deletion、Privacy、Idempotency、Concurrency、Versioning 或 Migration 任一项
  未回答，Schema 任务保持 BLOCK。

## 5. Derivation

结论：Asset 派生表示可多 Provider、多版本并存，不再把派生物当根事实。

- identity 为 `(assetVersionId, kind, variant, producer, producerVersion)`；
- 同 identity 重试幂等收敛，不同 identity 互不覆盖；
- 内容身份由 storage key、checksum、byte size 确定；
- 默认选择规则稳定，显式 identity 读取不漂移；
- 原 AssetVersion 是内容事实，Representation/Embedding/Keyframe/Transcription 是派生物；
- D04 的 legacy text/transcription mirror 有明确退出条件，不在未完成切读和回退窗口前物理删除。

## 6. Migration

结论：多人快速开发有可执行且 fail-closed 的 Migration 纪律。

- 历史 SQL/snapshot 不可修改；journal 前缀不可变、只允许合法尾部追加；
- 新 migration 的 SQL/snapshot/journal 必须成套，编号、tag、prevId 链一致；
- records 要求语义、锁、回退、N-1、Fresh、Data migration、Estimated scale、风险；
- CI 已拆 db/worker/migration integration，`checks` 聚合保持唯一 required context；
- CI impact 未知路径 fail-open，migration base/head 解析失败 fail-closed；
- fresh→head 与 0052→0053 N-1 均通过；drizzle check/generate 无 0054；
- 0051 snapshot 漏记对象冻结为历史 metadata anomaly：禁止回写，0052+ snapshot 承接
  后续 metadata，fresh catalog 回归守住最终运行态。

## 7. Operations

结论：代表性本地 PostgreSQL 已完成真实健康与查询计划审计；生产状态未伪造。

- shared live PostgreSQL 16.14：46 MiB、67 public 表、0 invalid index、短窗口无 blocker、
  idle-in-transaction、deadlock、temp spill；
- 14 类 critical SELECT 均运行 `EXPLAIN (ANALYZE, BUFFERS)`；isolated physical-0053 clone
  对关键 Watch 查询复核后删除；
- live 停在 0050 是显式 Watch，shared 数据全程零写入；
- recent conversation、active assets/artifacts、outbox lease 与 Hybrid post-filter 只在生产级
  参数下才可决定新索引；
- 0051–0053 production scale/orphan/lock/catalog preflight 是 release/operator 的上线前
  Action Required，不是已观测生产故障，也不伪装为本地已完成证据。

详见[D07 真实 PostgreSQL 健康与查询计划审计](11-D07-真实PostgreSQL健康与查询计划审计.md)。

## 8. Feature Data Contract

新长期事实必须在实现前填写：

```text
Domain
Authority
Owner
Parent
Retention
Deletion
Privacy
Idempotency
Concurrency
Versioning
Migration
```

判定顺序：

1. 先问是否为新的长期根事实；
2. 若不是，复用 Space / Conversation / Operation / Asset / Artifact / Ledger；
3. 若是，完整填写契约并给出唯一 Authority；
4. migration 前证明规模、锁、backfill、fresh/N-1 与 rollback；
5. 禁止用 Generic Entity/Relation/Event、任意 JSONB 或第二套 Runtime/RAG 绕过。

模板的 canonical 落点为[数据设计](02-数据设计.md)，67 表冻结矩阵仍在
[D01 契约文档](05-D01-数据权威生命周期与删除契约.md)。

## 9. Public Boundary 与反平行架构复核

- DB 应用公共面继续由 package exports / Repository 暴露；业务应用没有新增 raw DB client；
- `schema.ts` 只是兼容聚合入口，没有重开任意 internal export；
- 未创建第二 Agent loop、第二 Tool/Model ledger、第二 RAG、第二 queue business authority；
- Provider 类型、原始响应和秘密继续止于 model-gateway；
- Graphile Worker、缓存、派生物和 projection 均未提升为根事实。

## 10. Compatibility Exit Ledger

| Compatibility                               | 当前角色               | 退出条件 / 长期处置                                   |
| ------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| `chat_messages` + `conversation_messages`   | ADR-0013 受控迁移双轨  | 回填→切读→生产零旧调用→保留期→退役                    |
| legacy teaching ledger shapes               | 历史只读兼容           | 消息闸门完成、回放等价、保留期后 contract             |
| AssetVersion extracted/transcription mirror | D04 双写回退窗口       | 新对象读取全接线、生产零旧读、一个发布周期后 contract |
| `packages/db/src/schema.ts`                 | 稳定公共兼容入口       | 长期保留；它是 API 边界，不是待删债务                 |
| root `test:integration`                     | DB+Worker 聚合便利入口 | 长期保留；细分 CI lanes 才是路由权威                  |

D 线没有新增“无 owner、无退出条件”的临时业务权威。

## 11. D 完成定义逐项证明

| 完成项                       | 证据                                   | 状态      |
| ---------------------------- | -------------------------------------- | --------- |
| 每张长期表有领域与 owner     | D00/D01 67/67 matrix                   | PASS      |
| 每个事实唯一 authority       | D01 + 本文 §2                          | PASS      |
| 核心弱关系有解释             | D02 logical-ID ledger                  | PASS      |
| Asset→Workspace              | 0051 restrict FK                       | PASS      |
| Budget→Operation             | 0051 cascade FK                        | PASS      |
| 多版本/Provider derivation   | D04 identity                           | PASS      |
| Open Registry / Closed State | D03 gate                               | PASS      |
| Schema 多人低冲突            | D05 domain modules                     | PASS      |
| Migration fresh/N-1/rollback | D06 gates + D08 rerun                  | PASS      |
| 真实 PostgreSQL health/plan  | D07                                    | PASS      |
| 新表数据契约                 | canonical 数据设计                     | PASS      |
| DB public boundary           | import boundary + exports复核          | PASS      |
| 无第二 Runtime/Ledger/RAG    | 全仓架构复核                           | PASS      |
| compatibility 有退出条件     | §10                                    | PASS      |
| 全量测试和 CI                | §12；merge 前 required checks 必须全绿 | PASS gate |

## 12. 收口验证

本地验证均以当前工作区为准：

| 门禁                                    | 结果                                                         |
| --------------------------------------- | ------------------------------------------------------------ |
| DB unit / import boundary               | PASS                                                         |
| DB integration                          | PASS                                                         |
| migration governance / records / drift  | PASS，54/54 records，无 0054                                 |
| fresh→head / N-1→head                   | PASS，16/16 migration tests                                  |
| tooling quality                         | 非进程控制子集 152/152 PASS；2 项 macOS sandbox 进程测试单列 |
| workspace typecheck / lint              | PASS                                                         |
| workspace unit                          | 25/25 packages PASS（正常本机 socket 权限）                  |
| relevant Chromium smoke / E2E typecheck | PASS                                                         |
| file governance / Prettier / diff check | PASS                                                         |

本机 Node 24.18.0 与仓库 Node 22 engine 不同；所有代码结论以实际测试结果为准，远端
GitHub Actions Node 22 required checks 是最终环境证据。closeout PR 只有 required checks
全部成功后才允许合并；因此进入 main 的归档提交本身构成 D 线远端 CI 收口证据。

## 13. 文件与变更边界

- 新增 D07/D08 交付文档；
- 更新 canonical 数据设计；
- fresh migration test 增加 D02 catalog 回归；
- 压缩并归档 D 计划，同步 active/completed/root 索引；
- 未改 schema、repository、migration SQL/snapshot/journal、依赖、业务数据或 shared live。

## 14. 后续边界

- UV：复用 Asset/AssetVersion/Representation/Consent/Retention/Operation；禁止 voice v2 平行表；
- KM：Memory 可作为新 Domain，但必须完整填写 Feature Data Contract；Product Knowledge 复用现有 RAG；
- PET：主要属于 UI/Renderer/Preference/Runtime event adapter，不写瞬时动画 ledger；
- O：继续完成 outbox 并发、崩溃恢复、调度与残留证据；
- Release：执行 D07 所列 production preflight 与 Watch query plan，不把开发库数据当生产证据。

D08 = PASS。D 线归档，Core Architecture Freeze 生效。
