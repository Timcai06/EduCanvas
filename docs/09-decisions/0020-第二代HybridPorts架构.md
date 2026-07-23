# ADR-0020：第二代 Hybrid Ports Agent 架构

- 状态：`accepted`
- 日期：2026-07-21
- 最后复核：2026-07-23
- 决策人：项目负责人
- 前置研究：[第二代架构研究](../plan/completed/2026-07-第二代架构研究.md)
- 实施计划：[第二代架构升级](../plan/active/2026-07-第二代架构升级.md)

## 背景

EduCanvas 已经拥有 Web、TUI、Gateway、Notebook、教育领域服务和 PostgreSQL 账本。第二代架构要解决的不是目录形态或框架缺失，而是当时 Gateway、Web General、Web Teaching 分别组合 Turn，通用与教学工具生命周期分叉，运行审计和恢复语义不完整。

对 OpenClaw、Claude Code/Codex、LangGraph、AI SDK、MCP 与 OpenTelemetry 的研究证明：成熟项目可以提供 Gateway、循环、审批、工具协议和可观测性模式，但不能替代 EduCanvas 的多 Actor Notebook、未成年人安全、教育可信事实与 Operation 单终态。

## 决定

### 1. 产品与进程形态

EduCanvas 是以教育能力为核心的通用个人 Agent 平台。默认对话不强制进入课程；结构化 K12 Profile 只在需要诊断、练习、测评、掌握度或学习证据时按需启用。

继续采用 `apps/ + packages/` 的 pnpm/Turborepo 模块化单体。Web、Gateway、Worker、TUI、Channel 与 Node 可以是不同进程或部署入口，PostgreSQL 仍是业务事实源。没有负载、隔离或团队发布证据时，不以微服务、Redis、Kafka 或 Kubernetes 代表架构升级。

### 2. 稳定运行边界

```text
Gateway logical authority
  -> Turn Application Service
    -> Context Engine
    -> AgentLoopEngine
    -> Tool Kernel
    -> Profile and Domain Services
```

- Gateway 唯一拥有认证后的路由、Operation、审批、控制事件与投递事实；
- Web 可以使用共进程 BFF/SSE Adapter，TUI、Channel 与 Node 使用 Gateway 协议；传输不同不得产生第二套身份、工具策略、Turn 或终态；
- Turn Application 唯一编排 Context、Loop、Tool、Ledger 与 Domain hooks；
- Context Engine 产生版本化、可解释、按 Actor/Notebook 过滤的 Snapshot，但不是长期 Memory 事实源；
- AgentLoopEngine 唯一负责有界模型/工具循环、取消、强制 synthesis 与循环终态；
- Tool Kernel 统一 Local、Teaching、MCP 与 Node Adapter 的能力交集、审批、effect、timeout、cancel 和 `outcome_unknown`；
- Education 通过 Profile 与确定性 Domain Services 提供安全、状态机、判分、掌握度和学习事件，不拥有第二模型循环。

### 3. 唯一事实与恢复

- Operation Event 是跨入口控制事实，只有 Gateway Operation writer 可提交 Operation 终态；
- Turn Ledger 记录消息、Model、Tool 与 Context 执行事实；
- Learning Event 只能由可信教育领域服务写入；
- Workflow Checkpoint、Worker Job 与 Trace 都是可替换基础设施，不能成为 Notebook、Operation 或学习事实源；
- 普通 Turn 不图化；只有审批、外部等待和分钟级任务使用 PostgreSQL 业务状态与 graphile-worker continuation；
- write Tool 必须先记录稳定 effect intention。结果未知时保持 `outcome_unknown`，禁止盲目重试或通过再次 invoke 猜测结果。

人工对账只允许受信 operator/service principal 追加决议，不回写历史 Tool、Effect 或 Operation 终态。自动 verifier 只有在真实 Adapter 提供受信查询或服务端幂等契约后才允许接入；MCP v1 当前没有该契约，因此自动路径保持关闭。

### 4. 技术采用边界

| 分类     | 决定                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 保留自研 | Gateway authority、Actor/Agent/Notebook/Membership、Turn/Context/Tool 内核、Operation/effect/学习账本、教育安全与 Artifact 信任 |
| 采用     | graphile-worker；AI SDK 与 OpenTelemetry 仅位于稳定 Port 后并可关闭                                                             |
| 适配     | MCP 只作 External Tool Adapter；OpenClaw、Claude Code/Codex 只学习产品、协议和安全模式                                          |
| 延后     | LangGraph 有界 Workflow、Temporal、MCP Tasks、A2A、框架 Memory/Session、自动 effect verifier、微服务拆分                        |
| 拒绝     | framework-first 重写、每 Turn 图化、框架 Session/Checkpoint 成为业务事实源、MCP 作为内部总线                                    |

只有候选方案在相同身份、隐私、教育事实、故障恢复和回滚约束下，把实现、验证与运维总成本降到当前基线的 70% 以下，才重开本 ADR。

### 5. 隐私与数据

- Notebook Membership 只共享 Notebook 内显式 Source、Conversation、Artifact 与 Notebook Memory；
- Personal Memory、Credential、Node 与 default grant 绑定个人 Actor/Agent，不随 Notebook 共享；
- Context、Tool 与 continuation 每次执行或恢复都重新验证可信身份与 Membership；
- Trace 默认不记录学生正文、Prompt、判分键、Token、Secret、Credential 或对象 key；
- Schema 迁移保持 additive，旧 ID 可追溯，不长期 dual-write。

## 当前实现与收口边界

截至 2026-07-23，唯一 `TurnApplicationService`、`AgentLoopEngine`、Context Engine、Tool Kernel、统一运行账本、跨进程 continuation/cancel 和可关闭 Trace Adapter 已落地。Gateway、Web General、Web Teaching 都通过统一服务运行；剩余工作是入口能力一致性、最小人工对账入口、清理、验证与 canonical 文档收口。

以下不再作为第二代架构完成条件：没有真实消费者的自动 verifier、完整生产 Collector/SLO、正式 IdP、渠道平台资格、Notebook Memory、原生多模态和教学质量评测。它们进入后续产品或生产计划。

## 后果

- 教育能力不再等于第二 Runtime，普通教育问答也不必进入课程状态机；
- Web 可以保留成熟的 BFF/SSE 体验，同时与远程 Gateway Client 共享控制事实；
- Provider、Tool 协议、Workflow 与 Trace 技术可以替换，Notebook、权限、学习历史和 Operation 不跟随框架迁移；
- 第二代架构有明确结束条件，不因未来基础设施需求无限延长。

## 接受与复核记录

项目负责人于 2026-07-21 接受本 ADR，并于 2026-07-23 确认本次纠偏：教育是核心能力而非始终开启的教学模式；Gateway 是逻辑权威而非强制网络跳转；第二代架构完成统一内核和必要一致性后收口；自动对账与完整 OTel 不再作为当前 Goal 的前置条件。
