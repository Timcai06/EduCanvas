# ADR-0020：Personal 与 Notebook 长期记忆边界

- 状态：`accepted`
- 日期：2026-08-01
- 负责人：@Timcai06
- 来源：[系统级长期记忆研究](../research/2026-07/13-系统级长期记忆研究.md)

## 背景

EduCanvas 已把 Notebook 定义为资料、目标、对话和学习产物的共同边界，但长期使用的个人 Agent 还需要跨 Notebook 记住用户明确授权保存的偏好与稳定背景。同时，Conversation 需要短期工作记忆来承载当前推理、工具结果和续跑状态。

研究阶段确认了三层 Memory 架构方向，项目负责人已确认以下原则。本 ADR 将已确认方向提升为 accepted 决策；尚未实现的表、Repository、MemoryPort、UI 和自动提取继续标记为 planned。

## 决定

### 1. 三层 Memory 作用域

| 层                          | 作用域                       | 归属         | 生命周期               |
| --------------------------- | ---------------------------- | ------------ | ---------------------- |
| Personal Memory             | 跨 Notebook 的用户级长期记忆 | 自然人       | 用户显式创建/更正/删除 |
| Notebook Memory             | 一个学习工作空间的集体记忆   | Notebook     | 与 Notebook 同生命周期 |
| Conversation Working Memory | 当前任务的工作记忆           | Conversation | 短期，可压缩/过期      |

### 2. Personal Memory 全用户开放

Personal Memory 面向所有已认证个人用户开放，不按 Notebook 限制其可用性。

必须同时满足：

- 只属于当前自然人的 Personal Agent；
- 不因共享 Notebook、班级、教师或家长关系向其他主体传播；
- 可查看、可解释来源、可更正、可删除、可禁用；
- 与 Notebook Memory、Conversation Working Memory 明确分层；
- 权威身份、权限、Credential、学习掌握度、判分、Goal 等专用事实不能被 Memory 覆盖。

### 3. "全量开放"的边界

- 不等于无限保存全部聊天；
- 不等于默认抽取敏感信息；
- 自动提取、敏感信息、未成年人治理如果尚未实现，明确写成后续阶段，不得伪装为当前能力。

### 4. 权威事实优先

以下数据必须继续由其专用契约和服务写入，不能成为 Memory 的可覆盖字段：

| 权威数据                             | 写入边界                     |
| ------------------------------------ | ---------------------------- |
| 身份、角色、权限、Credential         | Gateway 与身份/授权仓储      |
| 年龄段、年级、声明来源及五维教学偏好 | Learner Profile 契约         |
| Goal、Objective、Session             | Study Plan 服务              |
| 诊断答案、判分、掌握度               | 确定性 Teaching Core/Runtime |
| Approval、Operation、Effect 账本     | Gateway/Tool Kernel          |
| 来源原文、Representation、Chunk      | Source 摄取管线              |

冲突时，权威事实总是胜过 Memory。

### 5. K12 隐私红线

禁止从聊天自动建立以下跨 Notebook 记忆：

- 医疗、心理诊断、性、宗教、政治倾向；
- 精确住址、实时位置、学校证件和生物特征；
- "聪明/懒惰/内向/多动"等人格或能力标签；
- 未经本人确认的年龄、性别、家庭关系和经济情况；
- 教师或家长对学生的私密评价。

### 6. 三层之间没有隐式提升

- Conversation 摘要只有经用户选择或受控规则确认后才能成为 Notebook Memory；
- Notebook 信息只有其自然人所有者重新授权后才能成为 Personal Memory；
- copy、move、share、revoke 都创建可审计的新关系；
- Conversation、Notebook 或成员权限撤销后，所有上层候选必须重新验证来源授权。

## 当前实现与目标状态

| 能力                   | 当前状态            | 目标状态          |
| ---------------------- | ------------------- | ----------------- |
| 三层 Memory Schema     | **未实现**          | M0 定义契约后建立 |
| Personal Memory ADR    | **本 ADR accepted** | —                 |
| 年龄/身份/租户授权矩阵 | **未实现**          | M0 必须先接受     |
| 显式可见的 Memory UI   | **未实现**          | M1 实现           |
| 来源型 Notebook Memory | **未实现**          | M2 实现           |
| 候选提取与巩固         | **未实现**          | M3 实现           |
| Memory 语义检索增强    | **未实现**          | M4 评测触发       |

## 验证方式

- M0 完成前，Personal Memory 不向任何用户开放；
- 三层 Memory 表、Repository 和 Context Compiler 分层预算在 M1 实现；
- 自动提取和模型候选在 M3 前不得启用；
- M0 完成前全部关闭；完成后所有已认证个人用户均可使用 Personal Memory。年龄、身份和租户矩阵约束同意、敏感类型、保留期与监护流程，不再决定已认证用户是否拥有该能力；匿名主体仍不开放。
