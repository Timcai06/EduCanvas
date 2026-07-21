# Agent 编排边界

- 状态：`accepted`
- 负责人：项目负责人
- 最后验证时间：2026-07-21
- 内容边界：定义稳定术语、可信边界与当前实现；第二代收敛方案见[第二代架构提案](../02-architecture/03-第二代架构提案.md)
- 关键决策：[ADR-0017](../09-decisions/0017-unified-runtime-and-notebook-context.md)、[ADR-0018](../09-decisions/0018-capability-trust-and-learning-evidence.md)

## 一、稳定术语

| 术语         | 定义                                                        | 不等于                           |
| ------------ | ----------------------------------------------------------- | -------------------------------- |
| Notebook     | Source、Conversation、Artifact 与共享 Membership 的上下文根 | 用户身份、模型 Session、工作目录 |
| Conversation | Notebook 内面向用户的连续对话                               | 授权边界、Runtime checkpoint     |
| Turn         | 一次用户输入及其模型、工具、领域处理与终态                  | 长期任务、整个 Conversation      |
| Agent Loop   | 一个 Turn 内受预算约束的模型与工具多圈循环                  | 业务 Workflow、Gateway 路由      |
| Operation    | Gateway 对一次可恢复请求的持久控制面记录与事件序列          | 模型 Run、Worker Job             |
| Workflow     | 明确状态、guard 与等待点的有界业务流程                      | 每一个普通 Turn                  |

这些概念必须有稳定 ID 和单一所有者，不能让框架的 session、thread 或 checkpoint 替换 EduCanvas 的身份、Notebook 或业务事实。

## 二、当前事实与目标不变量

| 主题             | 当前事实                                                   | 目标不变量                                |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------- |
| Agent Loop       | 统一服务与旧Teaching各构造同一`AgentLoopEngine`类          | 最终只有统一服务一个生产构造位置          |
| Turn Application | Gateway与Web General已迁唯一服务，Web Teaching仍为旧路径   | 收敛为一个 Turn Application Service       |
| Tool Runtime     | Web General走Tool Kernel，Teaching仍走专用Executor         | 一个 Tool Kernel 统一策略与执行语义       |
| Context          | Gateway与Web General已统一并写Snapshot，Teaching仍单独装配 | 预算选择后固化可审计 Context Snapshot     |
| Audit            | Gateway/Web General已写通用Ledger，Teaching仍待单写迁移    | ID 对齐、职责唯一，不建立第二事实源       |
| Continuation     | 可恢复事件读取；审批通过后不会自动续接计算                 | 以 Operation 为业务游标，副作用可幂等续跑 |

Profile 的确定性策略位于唯一服务的两个显式边界：`preflight` 在 Context、Model Run 和 Tool 副作用前拒绝不允许的输入；`OutputGuard` 位于 Provider delta 与公开事件之间，只能释放已放行片段，并在命中策略时中止当前模型运行、写入固定公开回应和 `POLICY_BLOCKED` 终态。闸门实现必须有界缓存，安全审计失败不能被伪装成成功回答。该契约为 Web Teaching 迁移准备，通用 Profile 不默认启用 K12 策略。

## 三、统一 Agent Loop

`packages/agent-runtime/src/agent-loop.ts` 中的 `AgentLoopEngine` 是唯一循环实现：

```text
validate request
  -> run budgeted model request
  -> if tool calls: validate, execute, record, continue
  -> if answer: emit terminal result
```

循环拥有模型轮数、工具圈数、跨圈文本、取消、强制 synthesis 和单终态纪律。它不拥有主体认证、Notebook Membership、Prompt/Context 装配、领域判分或持久 Operation。`TurnApplicationService` 在循环外统一执行输入 preflight 和流式 OutputGuard；Gateway与Web General只通过该服务调用循环，旧Teaching Orchestrator仍直接实例化，迁移完成前不能声称生产构造点唯一。

当前 Web General 默认最多三圈工具；K12 Profile 默认一圈并可在预算内配置。具体数值属于组合根策略，不应写死为 Engine 的永久协议。

## 四、能力组合模型

| 层             | 作用                                           | 示例                                 |
| -------------- | ---------------------------------------------- | ------------------------------------ |
| Agent Profile  | 常驻身份、目标、模型策略、预算、安全与默认工具 | K12 AI 教师                          |
| Skill          | 按需加载的指导、模板或有限工作流               | 结构化课程、苏格拉底追问、来源综述   |
| Tool           | 有双向 Schema、权限、超时和审计的动作          | 搜索、生成 Artifact、读取学习状态    |
| Domain Service | 产生或校验可信领域事实                         | 服务端判分、掌握度更新、未成年人策略 |

Profile 不拥有模型循环；Skill 不直接写数据库；Tool 获准不代表结果自动可信；Domain Service 不依赖模型自述。

模型可见工具必须是以下交集，而不是某个入口写死的列表：

```text
Profile allowlist
∩ subject permissions
∩ Notebook membership
∩ client/channel/node capabilities
∩ environment/provider capabilities
∩ safety policy
∩ optional workflow state policy
```

写工具需要明确副作用等级、审批、幂等、超时和结果未知语义；模型输出不能创建 grant 或改变风险等级。

## 五、Context 边界

Context 不是把 Notebook 全部数据拼成字符串。应用层应从 Profile/System、Notebook 摘要、最近完整消息、选中或检索命中的 Sources、Artifact 版本、相关学习者记忆和本轮多模态 Part 中按预算选择。

历史消息不能注入 `system` 角色；来源必须经过所有权与候选白名单；Provider 支持原生媒体时不应先降级为文字描述。Gateway与Web General已使用统一预算和持久Context Snapshot；Web资产文本按不可变AssetVersion分段记录并保持不可信资料边界，Teaching装配仍待迁移。历史窗口必须取最新N条后恢复正序，不能让长会话把当前消息挤出Context。

## 六、教育能力与可信事实

K12 Profile 默认像一位会使用工具的通用老师：理解问题、结合资料讲解、追问理解、生成多模态示例与练习，并根据反馈调整。普通教学问答不要求先创建课程 Session，也不自动推进五阶段状态。

当前教育能力组合覆盖经审核来源检索、可信掌握度读取、Quiz/实验/流程动画/Slides 等受控 Artifact、年龄与未成年人安全、服务端判分和显式 `structured-course` Workflow。能力是否对某一入口可见，仍必须通过统一工具策略计算，不能仅因 K12 Profile 存在就自动授权。

只有用户选择课程、教师布置任务或产品明确进入结构化学习流程时，才启用：

```text
DIAGNOSE -> EXPLAIN -> DEMONSTRATE -> PRACTICE -> ASSESS
```

此时状态、guard、掌握度和可信学习事件由教育 Domain Service 维护。自由问答可以横切课程流程，但不会仅因模型回答而改变状态；普通对话没有 `lessonState` 是合法状态。

服务端判分、掌握度更新和状态转移不应作为普通写工具直接交给模型。模型可以建议测验或补救，确定性领域逻辑才有权提交学习事实。完整边界见 [ADR-0018](../09-decisions/0018-capability-trust-and-learning-evidence.md)。

## 七、Operation、Workflow 与持久任务

- Gateway Event 的 `operationId + sequence` 支持断线后的事件恢复；
- 事件恢复不等于计算续跑：当前审批通过、进程崩溃或等待外部结果后，没有统一 continuation 执行器；
- Artifact 生成、资料摄取、OCR、音视频渲染等分钟级工作由 Worker 处理；
- 普通 Turn 不应全部进入耐久 Workflow；只有存在明确等待点、人工审批或跨进程副作用的有界流程才需要 checkpoint/continuation；
- 无论采用原生实现还是 LangGraph，Operation 仍是业务游标，权限与 effect ledger 仍由 EduCanvas 拥有。

## 八、框架边界

- 不以 LangChain、LangGraph、AI SDK、MCP 或 Provider SDK 作为领域事实源；
- 可以在稳定 Port 后采用框架做 Provider 适配、外部工具协议、有限 Workflow 或可观测性；
- 不把框架 Session/Thread 当 Notebook，不把 checkpoint 当授权，不把 trace 当业务账本；
- 第一阶段不开放宿主机 Shell、任意文件系统、无约束代码执行或多 Agent 编队；
- 安全、预算、权限、判分和学习状态必须在模型之外可测试、可审计。

当前统一通用路径、旧教学路径和审计双轨的代码证据见[系统架构现状](../02-architecture/01-系统架构现状.md)，收敛顺序见[第二代架构升级计划](../plan/active/2026-07-第二代架构升级.md)。
