# 学习事件契约

- 状态：`accepted`
- 负责人：@Timcai06
- 最后验证：2026-07-14
- 相关决策：[ADR-0006](../09-decisions/0006-trusted-learning-events.md)

## 两层事件模型

### CanvasInteractionEvent

由浏览器产生，只描述学生在Canvas中的操作，是不可信输入。阶段一事件包括：

- `artifact_rendered`
- `animation_started`
- `animation_paused`
- `animation_step_completed`
- `hint_requested`
- `quiz_answer_submitted`
- `classification_submitted`

客户端事件不得包含`isCorrect`、`masteryScore`、目标状态或误区结论。具体Zod Schema由`packages/canvas-protocol/src/events.ts`维护。

### DomainLearningEvent

由教学运行时、判分器或受控工具在服务端生成，是`learning_events`中的可信事实；运行时Schema位于`packages/teaching-core/src/domain-events.ts`。阶段一核心集合：

| 事件                    | 产生者       | 用途                                 |
| ----------------------- | ------------ | ------------------------------------ |
| `state_transition`      | 教学运行时   | 回放五状态脊柱和转移原因             |
| `assessment_graded`     | 服务端判分器 | 更新答题次数、正确次数和证据窗口     |
| `hint_recorded`         | 教学运行时   | 更新提示次数并记录提示层级           |
| `misconception_updated` | 误区工具     | 记录标签激活、解决和证据             |
| `artifact_completed`    | 教学运行时   | 记录完成受控教学活动，不直接等同掌握 |

`mastery_states`是这些事实计算出的当前投影，不是由客户端或模型直接写入的事件。

## 客户端事件信封

```text
schemaVersion
eventId
type
artifactId
occurredAt
payload
```

- `eventId`由客户端生成，用于一次提交在网络重试时去重；
- `occurredAt`必须带时区，但服务端不依赖它确定最终顺序；
- 每个`type`绑定自己的strict payload Schema。

## 领域事件信封

```text
eventId
idempotencyKey
studentId
sessionId
knowledgeNodeId
sequence
eventType
payload
occurredAt
recordedAt
source
schemaVersion
causationId
```

- `sequence`由服务端在单个会话内单调分配，是回放顺序依据；
- `recordedAt`由服务端生成，`occurredAt`保留原始行为时间；
- `causationId`关联触发它的客户端事件、工具调用或前一领域事件；
- `idempotencyKey`在对应业务边界内唯一；
- `source`只能取已注册服务或迁移任务标识。

## 信任提升规则

```text
quiz_answer_submitted
→ 校验会话与当前Artifact
→ 使用服务端GradingKey判分
→ assessment_graded
→ 重算mastery_states
```

```text
hint_requested
→ 校验当前状态与提示权限
→ 生成提示
→ hint_recorded
→ 重算mastery_states
```

动画开始、暂停和普通步骤完成默认只进入观测日志。只有教学运行时根据受控Artifact规则确认整个活动完成时，才生成`artifact_completed`；该事件在掌握度v1中仍不直接计分。

## 答案与判分边界

模型生成的测验定义先在服务端完成Schema校验并持久化，然后向浏览器投影为不含正确答案的展示Artifact。浏览器只提交选择或分类映射，服务端以保存的答案和评分规则生成结果。

实现中浏览器安全入口为`@educanvas/canvas-protocol`，包含答案的完整协议与判分函数只能从`@educanvas/canvas-protocol/server`导入；数据库分别保存公开`canvas_artifacts`和私有`canvas_artifact_grading_keys`。`GradeCanvasSubmissionService`负责在同一事务追加`assessment_graded`并更新掌握度投影。

阶段一允许本地UI为了交互流畅显示选中状态，但不得根据客户端自报结果写入`learning_events`或`mastery_states`。

## 版本规则

- 客户端事件和领域事件分别维护Schema版本；
- 新增可选字段可以保留版本，删除、改名或改变语义必须升版本；
- 消费者必须按版本选择Validator，不能先解析为任意JSON再自行猜测；
- 旧版本停止写入后，Validator仍需保留到对应学习会话和审计数据超过保留期。
