# 数据设计

- 状态：`draft`

## 数据原则

- PostgreSQL是业务事实源；
- Redis数据丢失不能导致学习历史丢失；
- 学生掌握度使用结构化字段，不让大模型凭感觉决定；
- 原始内容、处理结果和Embedding分层保存；
- 所有记录包含租户、版本和审计信息；
- 未成年人数据最小化收集。

## 核心实体

- `users`
- `student_profiles`
- `courses`
- `course_versions`
- `knowledge_nodes`
- `knowledge_edges`
- `lesson_sessions`
- `canvas_artifacts`
- `learning_events`
- `mastery_states`
- `knowledge_sources`
- `knowledge_documents`
- `knowledge_chunks`
- `embedding_spaces`
- `model_calls`
- `audit_logs`

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
- `misconception_tags` 为对象数组 `{ tag, status: active | resolved, first_seen_at, last_seen_at }`——标签有生命周期，只有 `active` 参与掌握度计算；JSONB 形状变化，无需 SQL 迁移；
- `learning_events` 是事实源，`mastery_states` 是导出值：必须能从事件流完整重算，重算结果与线上值一致是回放测试的验收标准。

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

## PostgreSQL工程要求

- 连接统一经过PgBouncer；
- 高频事件表按时间或租户评估分区；
- 多租户字段建立组合索引；
- 业务写入和事件发布采用Transactional Outbox；
- 公开`canvas_artifacts.params`与私有`canvas_artifact_grading_keys`物理分表，页面数据查询不得触碰判分键表；
- 备份、PITR和恢复演练纳入上线检查。
