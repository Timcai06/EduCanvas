# 数据设计

- 状态：`draft`

## 数据原则

- PostgreSQL是业务事实源；
- Redis数据丢失不能导致学习历史丢失；
- 学生掌握度使用结构化字段，不让大模型凭感觉决定；
- 原始内容、处理结果和Embedding分层保存；
- 所有记录包含租户、版本和审计信息；
- 未成年人数据最小化收集。

## 实现分层

### 阶段一已实现表

- `lesson_sessions`：会话状态、中断状态、状态版本和事件序号；
- `canvas_artifacts`：浏览器安全的Artifact公开投影；
- `canvas_artifact_grading_keys`：与题面物理分离的私有判分键；
- `learning_events`：严格领域事件信封的只追加事实流；
- `mastery_states`：学生 × 知识节点的当前掌握度投影。

物理字段、索引和约束以`packages/db/src/schema.ts`及已生成迁移为准。迁移`0002`/`0003`尚未在真实PostgreSQL环境完成应用与回滚验证，当前Drizzle适配器测试使用内存替身，不等同于数据库集成测试。

### 目标实体

`users`、`student_profiles`、`courses`、`course_versions`、`knowledge_nodes`、`knowledge_edges`、`knowledge_sources`、`knowledge_documents`、`knowledge_chunks`、`embedding_spaces`、`model_calls`和`audit_logs`尚未进入阶段一Schema，随认证、课程、RAG和模型网关能力逐步引入。

pgvector是已接受的向量检索基础设施方向；当前仓库还没有向量表、索引、摄取流水线或`KnowledgeRetriever`适配器。

## 掌握度字段

```text
student_id
knowledge_node_id
mastery_score
attempt_count
correct_count
hint_count
misconception_tags
last_practiced_at
next_review_at
version
```

- `mastery_score` 的计算公式、REMEDIATE/ADVANCE 阈值和复习调度规则由 [ADR-0005](../09-decisions/0005-mastery-modeling.md) 确定，实现规格见 `docs/03-ai/mastery-and-misconceptions.md`；
- 目标`misconception_tags`为对象数组 `{ tag, status: active | resolved, first_seen_at, last_seen_at }`——标签有生命周期，只有 `active` 参与掌握度计算；当前Port与适配器仅保存活跃标签字符串数组，生命周期投影、迁移与测试待实现；
- `learning_events` 是事实源，`mastery_states` 是导出值。完整事件回放后与线上投影一致是验收标准；当前仅有`assessment_graded`驱动的增量更新，还没有可从零重建状态、提示和误区投影的Replayer/Projector。

## 学习事件

学习事件采用只追加方式，至少包含：

```text
event_id
idempotency_key
student_id
session_id
knowledge_node_id
sequence
event_type
payload
occurred_at
recorded_at
source
schema_version
```

- Canvas交互事件是不可信输入，不能直接写成影响掌握度的领域事实；
- 服务端依据会话、答案和状态机规则验证后，才生成可信领域事件；
- 每种领域事件使用与`event_type`绑定的严格payload Schema，禁止影响掌握度的字段落入任意JSON；
- `sequence`由服务端在会话内单调分配，用于确定性回放；`occurred_at`记录行为发生时间，`recorded_at`记录服务端接收时间；
- `idempotency_key`防止客户端重试、网络重放或Worker重试产生重复计数；
- `lesson_sessions.event_sequence`通过数据库原子递增分配序号，不使用“查询最大值+1”的并发不安全做法；
- 具体事件集合、信任提升和答案边界见[学习事件契约](learning-event-contract.md)与[ADR-0006](../09-decisions/0006-trusted-learning-events.md)。

## 生产工程要求（目标态）

以下项目是上线前的工程要求，不代表阶段一开发环境已经部署：

- 连接统一经过PgBouncer；
- 高频事件表按时间或租户评估分区；
- 多租户字段建立组合索引；
- 业务写入和事件发布采用Transactional Outbox；
- 公开`canvas_artifacts.params`与私有`canvas_artifact_grading_keys`物理分表，页面数据查询不得触碰判分键表；
- 备份、PITR和恢复演练纳入上线检查。
