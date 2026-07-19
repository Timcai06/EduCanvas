# Agent 编排

- 状态：`accepted`
- 最后验证时间：2026-07-19
- 关键决策：[ADR-0017](../09-decisions/0017-unified-runtime-and-notebook-context.md)、[ADR-0018](../09-decisions/0018-capability-trust-and-learning-evidence.md)

## 核心原则

EduCanvas 只有一个生产 Agent Loop：`packages/agent-runtime/src/agent-loop.ts` 中的 `AgentLoopEngine`。Gateway 先完成身份、Notebook 路由与能力协商；模型负责理解、表达和提出工具调用；Runtime 负责上下文、预算、工具授权、取消、终态和 Trace；可信领域服务负责判分、权限和状态写入。任何入口或 Profile 都不能绕过这些边界。

## 能力组合模型

| 层             | 作用                                           | 示例                                      |
| -------------- | ---------------------------------------------- | ----------------------------------------- |
| Agent Profile  | 常驻身份、目标、模型策略、预算、安全与默认工具 | K12 AI 教师                               |
| Skill          | 按需加载的指导、模板或有限工作流               | 结构化课程、苏格拉底追问、来源综述        |
| Tool           | 带双向 Schema、权限、超时和审计的动作          | 搜索、读网页、生成 Artifact、读取学习状态 |
| Domain Service | 产生或校验可信领域事实                         | 服务端判分、掌握度更新、未成年人策略      |

Profile 不拥有自己的模型循环；Skill 不直接写数据库；Tool 获准不意味着结果自动可信；Domain Service 不依赖模型自述。

## 统一 Agent Loop

```text
validate request
  -> build budgeted context snapshot
  -> run model
  -> if tool calls: authorize, validate, execute, record, continue
  -> if answer: safety gate, persist terminal state, stream completion
```

循环必须有显式预算：最大模型运行数、最大工具圈数、每工具超时、总时长、输入/输出规模和持久任务提交上限。达到预算后返回稳定、诚实的终态，不让模型决定继续无限运行。

每一圈写入可恢复账本：Context Snapshot、Model Run、Tool Call、引用候选/实际子集、安全决策和终态。SSE 只是该运行事实的实时投影，不是事实源。

## 工具策略

模型可见工具集合由 Runtime 计算：

```text
Profile allowlist
∩ subject permissions
∩ Notebook ownership
∩ environment/provider capabilities
∩ safety policy
∩ optional workflow state policy
```

工具注册必须包含稳定名称、用途、输入/输出 Schema、副作用等级、幂等策略、超时、暴露方式和审计字段。写工具不能在结果未知时自动重试；一批工具包含写操作时，不允许在部分执行后假装整批原子成功。

服务端判分、掌握度写入和状态转移属于 Runtime/事件触发的可信能力，默认不向模型直接暴露。模型可以建议“进行测验”，但不能提交“学生已掌握”作为事实。

## Context Engine

Context 不是把所有 Notebook 数据拼成一个字符串。Runtime 从以下 Segment 中按预算选择：

- Profile/System；
- Notebook 摘要；
- 最近完整消息；
- 所选或检索命中的 Sources；
- 当前 Artifact 版本；
- 与问题相关的学习者记忆；
- 本轮文本、图片、音频、视频或文件 Part。

选择结果必须固化到 Context Snapshot。历史消息不能注入 `system` 角色；来源必须经过所有权和候选白名单；媒体不应在 Provider 支持时先降级为文本描述。

## K12 AI 教师

K12 Profile 的默认工作是像一位能使用工具的通用老师：理解问题、结合资料讲解、追问理解、生成合适的多模态示例与练习，并根据学生反馈调整。它不需要为了回答一个问题先创建课程 Session，也不自动推进五阶段状态。

K12 Profile 可以注册：

- 经审核的教材与 Notebook 来源检索；
- 学习者相关记忆与已有可信掌握度读取；
- Quiz、分类实验、流程动画、Slides 等受控 Artifact；
- 年龄适配与未成年人安全策略；
- 服务端判分和学习事件领域服务；
- 显式 `structured-course` Skill/Workflow。

## 可选结构化课程

只有用户选择课程、教师布置任务或产品明确进入结构化学习流程时，才启用：

```text
DIAGNOSE -> EXPLAIN -> DEMONSTRATE -> PRACTICE -> ASSESS
```

此时使用教育领域中的状态、guard、掌握度和可信学习事件。REMEDIATE 和 ADVANCE 仍是 ASSESS 的出口决策。自由问答可以横切课程流程，但不会仅因模型回答而改变状态；完整信任边界见 [ADR-0018](../09-decisions/0018-capability-trust-and-learning-evidence.md)。

普通 K12 对话没有 `lessonState` 是合法状态；它不得写入虚假课程进度。结构化课程和自由教学共用同一 Agent Loop，只额外加载 Workflow 状态与领域策略。

## 持久任务

Artifact 生成、文档摄取、OCR、音频和未来视频渲染由 Worker 处理。Agent Loop 可以提交任务、向用户报告状态并在后续 Turn 观察结果，但不能在 HTTP 请求内等待分钟级流程或无限轮询。

## 当前实现

- `AgentLoopEngine` 唯一拥有多圈模型/工具执行、跨圈文本预算、取消、强制 synthesis 和单终态；
- Web 通用 Chat、`TeachingTurnOrchestrator` 与独立 `GatewayAgentTurnRunner` 都实例化该 Engine，只注入不同 Prompt、工具执行和领域回调；
- `turn-engine.ts` 负责每次模型运行的严格事件验证，不构成第二个编排循环；
- General 默认最多三圈工具，K12 当前 Profile 默认一圈并可在预算内配置；
- 教育判分、掌握度、课程状态和可信学习事件仍由确定性领域服务维护，不因循环统一而降级为模型输出。

Gateway-first 迁移证据见[已完成计划](../plan/completed/2026-07-gateway-first-personal-agent.md)。Context 摘要、长期记忆、Artifact Context 和原生多模态仍是下一阶段能力，不应与“循环已经统一”混为一谈。

## 框架边界

- 不以 LangChain、LangGraph、AI SDK 或 Provider SDK 作为领域事实源；
- 可以使用框架做流式适配、有限工作流或 UI，但核心契约归 EduCanvas；
- 第一阶段不开放宿主机 Shell、任意文件系统、无约束代码执行或多 Agent 编队；
- 所有安全、预算和权限判断必须在模型之外可测试、可审计。
