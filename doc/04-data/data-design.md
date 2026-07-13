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

## 掌握度建议字段

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

## 学习事件

学习事件采用只追加方式，至少包含：

```text
event_id
student_id
session_id
knowledge_node_id
event_type
payload
occurred_at
schema_version
```

## PostgreSQL工程要求

- 连接统一经过PgBouncer；
- 高频事件表按时间或租户评估分区；
- 多租户字段建立组合索引；
- 业务写入和事件发布采用Transactional Outbox；
- 备份、PITR和恢复演练纳入上线检查。

