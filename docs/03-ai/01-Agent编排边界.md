# Agent 编排边界

- 状态：`accepted`
- 负责人：项目负责人
- 最后验证时间：2026-07-22
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

| 主题             | 当前事实                                               | 目标不变量                            |
| ---------------- | ------------------------------------------------------ | ------------------------------------- |
| Agent Loop       | 三条生产入口只由统一服务构造；旧Teaching类无生产调用   | 物理删除遗留构造点                    |
| Turn Application | Gateway、Web General与Web Teaching均调用唯一服务       | 删除无调用实现并补齐高风险Adapter续跑 |
| Tool Runtime     | Local、Teaching、Node、MCP均走Tool Kernel              | 物理删除两套无调用旧Runtime           |
| Context          | 三条生产入口统一预算并写Context Snapshot               | 继续补Memory与原生多模态候选          |
| Audit            | 三条生产入口写统一Context/Model/Tool Ledger            | 补齐N-2与最终回滚证据                 |
| Continuation     | 审批、lease、取消和恢复账本已落地；无高风险生产Adapter | 以Operation为游标接通幂等副作用续跑   |

Profile 的确定性策略位于唯一服务的两个显式边界：`preflight` 在 Context、Model Run 和 Tool 副作用前拒绝不允许的输入；`OutputGuard` 位于 Provider delta 与公开事件之间，只能释放已放行片段，并在命中策略时中止当前模型运行、写入固定公开回应和 `POLICY_BLOCKED` 终态。闸门实现必须有界缓存，安全审计失败不能被伪装成成功回答。Web Teaching 已使用这两个边界；通用 Profile 不默认启用 K12 策略。

## 三、统一 Agent Loop

`packages/agent-runtime/src/agent-loop.ts` 中的 `AgentLoopEngine` 是唯一循环实现：

```text
validate request
  -> run budgeted model request
  -> if tool calls: validate, execute, record, continue
  -> if answer: emit terminal result
```

循环拥有模型轮数、工具圈数、跨圈文本、取消、强制 synthesis 和单终态纪律。它不拥有主体认证、Notebook Membership、Prompt/Context 装配、领域判分或持久 Operation。`TurnApplicationService` 在循环外统一执行输入 preflight 和流式 OutputGuard；Gateway、Web General与Web Teaching只通过该服务调用循环。旧Teaching Orchestrator仍保留兼容测试构造，但已无生产调用，清理后才能收紧为源码唯一构造位置。

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

历史消息不能注入 `system` 角色；来源必须经过所有权与候选白名单；Provider 支持原生媒体时不应先降级为文字描述。三条生产入口均使用统一预算和持久Context Snapshot；Web资产文本按不可变AssetVersion分段记录并保持不可信资料边界。历史窗口必须取最新N条后恢复正序，不能让长会话把当前消息挤出Context。

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
- 事件恢复与计算续跑保持两层：Gateway事件负责客户端断线恢复，PostgreSQL continuation + Graphile Worker只恢复明确的审批/外部等待点；
- Artifact 生成、资料摄取、OCR、音视频渲染等分钟级工作由 Worker 处理；
- 普通 Turn 不应全部进入耐久 Workflow；只有存在明确等待点、人工审批或跨进程副作用的有界流程才需要 checkpoint/continuation；
- L2/L3 Tool必须先过五维权限与参数Schema，再写pending Tool Call并调用Adapter的幂等`prepareApproval`；成功后Turn只发`approval.required`、Trace以`suspended`结束并保持无业务终态挂起，准备失败或取消不得伪装成已创建审批，更不能提前执行副作用；
- `prepareApproval`必须先写版本化最小意图；Gateway只消费同Operation、同Actor、同expiry的prepared意图，并在单事务创建公开审批与continuation，禁止事件存在而恢复游标缺失；
- W3C carrier由服务端的真实Turn span显式导出，只经审批意图与PostgreSQL continuation传递给Worker；不接受浏览器/渠道carrier，不将业务`traceId`伪造成W3C Trace ID，不让Trace参与授权、幂等或学习事实；
- write进入`outcome_unknown`后，原Effect、Tool Call与Operation终态保持不可变；后续确认只能追加独立reconciliation决议，不能把历史不确定性重写成当时已成功或已失败；
- 自动reconciliation verifier只能查询Provider/Adapter提供的受信外部事实，并且必须匹配Effect intention中由服务端冻结的verifier身份；调用方不能临时选择其他核验器，禁止invoke或重放副作用。MCP v1当前没有可信查询契约，自动核验必须fail closed。人工决议只允许受信operator或service principal，学生与模型都不能提交自证；
- 无论采用原生实现还是 LangGraph，Operation 仍是业务游标，权限与 effect ledger 仍由 EduCanvas 拥有。

## 八、框架边界

- 不以 LangChain、LangGraph、AI SDK、MCP 或 Provider SDK 作为领域事实源；
- 可以在稳定 Port 后采用框架做 Provider 适配、外部工具协议、有限 Workflow 或可观测性；
- 不把框架 Session/Thread 当 Notebook，不把 checkpoint 当授权，不把 trace 当业务账本；
- MCP `annotations`、远端Schema和工具输出均视为不可信；只有服务端注册能声明capability、risk与effect，Credential只经Broker短暂进入传输头；
- 第一阶段不开放宿主机 Shell、任意文件系统、无约束代码执行或多 Agent 编队；
- 安全、预算、权限、判分和学习状态必须在模型之外可测试、可审计。

当前三入口统一路径、遗留代码清理边界和审计事实见[系统架构现状](../02-architecture/01-系统架构现状.md)，后续continuation与Adapter收口见[第二代架构升级计划](../plan/active/2026-07-第二代架构升级.md)。
