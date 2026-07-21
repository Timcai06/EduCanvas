# ADR-0020：第二代 Hybrid Ports Agent 架构

- 状态：`proposed`
- 日期：2026-07-21
- 决策人：项目负责人（待确认）
- 研究计划：[第二代架构研究](../plan/active/2026-07-第二代架构研究.md)
- 研究证据：[研究索引](../research/00-研究说明.md)

## 背景

EduCanvas 已经拥有可工作的 Web、TUI、Gateway、唯一 `AgentLoopEngine`、Notebook/Conversation、教学领域、PostgreSQL 账本与 graphile-worker，但应用组合仍分叉：Gateway、Web General、Web Teaching 各自装配 Turn；通用和教学工具有两套执行路径；模型/工具审计偏教学专用；Operation 能 replay 已写事件，却不能在审批或崩溃后统一续跑。

源码研究表明 OpenClaw 的单一 Gateway truth、服务端路由、send/steer/abort、渠道 lifecycle 和 compaction 很适合产品方向；Claude Code/Codex 的单循环、权限/审批/取消分离也值得采用。对照实验同时证明，AI SDK、MCP、LangGraph 与 OpenTelemetry 能在局部 Port 后提供价值，但没有候选能取代 EduCanvas 的多 Actor Notebook、未成年人隐私、教育可信事实或 Operation 单终态。

## 决定

### 1. 产品与物理形态

EduCanvas 继续定位为“以教育能力为核心的通用个人 Agent 平台”。Web 是 K12 主入口，TUI 是高级入口，渠道和 Node 是远程输入/能力 Adapter；它们操作同一个 Personal Agent、Notebook、Conversation 与 Operation。

继续使用 `apps/ + packages/` 的 pnpm/Turborepo 模块化单体。Web、Gateway、Worker、TUI/Channel/Node 可以是不同进程，但 PostgreSQL 仍是业务事实源；不以重排目录、微服务、Redis、Kafka 或 Kubernetes 代表第二代完成。

### 2. 目标运行内核

生产目标是：

```text
一个 Gateway Control Plane
  -> 一个 Turn Application Service
    -> 一个 Context Engine
    -> 一个 AgentLoopEngine
    -> 一个 Tool Kernel
    -> 多个 Domain Services（Education 为默认 Profile）
```

- Gateway 唯一拥有认证后的路由、Operation、审批、控制事件与投递；
- Turn Application 唯一编排 Context、Loop、Tool、Ledger、Domain hooks 与 Operation 结果；
- Context Engine 产生版本化、可解释、按 Actor/Notebook 过滤的 Snapshot；
- AgentLoopEngine 继续拥有有界模型/工具循环、取消、强制 synthesis 与循环终态；
- Tool Kernel 统一本地、Teaching、MCP 与 Node Adapter 的有效能力交集、审批、effect ledger、timeout/cancel 和 `outcome_unknown`；
- Education 通过 Profile 和确定性 Domain Services 提供状态机、判分、掌握度、安全与可信学习事件，不拥有第二模型循环。

Web 可以保留 BFF + SSE projection，TUI/Channel 可以使用 Gateway 协议；传输不同不得产生第二套身份、工具策略、Turn 或终态。

### 3. 事实与恢复

采用[唯一写者与恢复矩阵](../research/2026-07/10-唯一写者与恢复矩阵.md)：

- Operation Event 是对外控制事实，只有 Gateway Operation writer 可提交终态；
- Turn Ledger 是消息、Model/Tool/Context 的业务执行事实，由 Turn Application 的 Ledger Port 写入；
- Workflow Checkpoint 只是可替换执行游标；
- Worker Job 只是至少一次调度与租约，不是业务完成；
- Trace 可丢弃，不能取代任一业务账本；
- 学习事实仍只有 Teaching Domain Services 可以写。

普通 Turn 不进入耐久图。approval、外部 Node/Channel 等待和分钟级 Artifact 使用 PostgreSQL 业务状态 + graphile-worker continuation；所有副作用依赖稳定 effect key。LangGraph 仅在未来有界复杂 Workflow 通过 30% 总成本门槛后，作为 `OperationContinuationPort` Adapter 重新评估。

### 4. 技术采用边界

| 分类           | 决定                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `build/retain` | Gateway authority；Actor/Agent/Notebook/Membership；Turn/Context/Tool 产品内核；Operation/effect/学习账本；教育安全与 Artifact 信任 |
| `adopt`        | 继续 graphile-worker；生产阶段在稳定 Trace Port 后采用 OpenTelemetry                                                                |
| `adapt`        | AI SDK 位于 `TurnModelGateway` 后；MCP v1 位于 External Tool Adapter；OpenClaw/Claude Code/Codex 只学习产品与协议模式               |
| `defer`        | LangGraph 有界 Workflow、Temporal、MCP v2 Tasks、A2A、框架 Memory/Session、微服务拆分                                               |
| `reject`       | framework-first 重写；每 Turn 图化；框架 Session/Checkpoint 成为 Notebook、Operation 或学习事实源；MCP 作为内部总线                 |

候选版本、许可证、官方来源和 strongest counterargument 见[候选技术与反方评审](../research/2026-07/11-候选技术与反方评审.md)。未来只要单一候选在相同硬约束下将实现、验证和运维总成本降到基线 70% 以下，必须重开本 ADR。

### 5. 隐私与数据

- Notebook Membership 只共享 Notebook 内显式 Source、Conversation 与 Artifact；不共享 Personal Agent；
- Memory、Credential、Node 与 default grant 必须绑定 `ownerActorId + ownerAgentId`，缺少生产模型时返回 unavailable；
- Context、Tool 与 continuation 每次执行/恢复都从可信身份和 Membership 重新计算权限，不能信客户端、模型、MCP annotations 或 checkpoint；
- Trace 默认只允许 `operationId`、stage 和 W3C 因果上下文，不记录学生正文、Prompt、判分键、Token、Secret、Credential 或对象 key；
- Schema 迁移只 additive；旧 ID 保留映射，禁止长期 dual-write，清理旧表另立决策。

## 迁移与回滚

1. 冻结 `TurnApplicationPort`、Context Snapshot、Tool Kernel、Ledger/Continuation/Trace Ports；
2. 先建立统一 Ledger 兼容读模型与 Tool effect ledger，不改入口；
3. 按 Gateway → Web General → Web Teaching 的顺序逐条迁移到同一 Turn Application，每次只切一个组合根；
4. 教学能力迁为 Profile/Domain hooks，但保持状态机、判分、学习事件和现有证据引用不变；
5. 接入 approval continuation、跨进程 cancel/lease 与故障恢复；
6. 最后接入候选 AI SDK/MCP/OTel Adapter，并用 native/旧 Adapter 保留回滚；
7. Web/TUI/Channel 同 Notebook、同工具策略、同终态与 PTY/E2E 全部通过后才结束双轨读取。

每一步使用 feature flag 或组合根选择 Adapter。回滚只切回上一 Adapter，不删除或反向改写已提交业务事实；若新旧 Schema 不双向兼容，发布必须停止而不是静默降级。

## 能得到的产品形态

- 学生在 Web 中获得 NotebookLM 式“一个 Notebook 管资料、对话与产物”，同时 Agent 能教学、搜索、生成多模态内容并在确定性规则下判分；
- 高级用户在 TUI 继续同一 Conversation，可 handoff 到 Web，也可管理连接、审批与运行；
- 微信/QQ/其他渠道未来通过设置页绑定后成为同一 Agent 的远程入口，不形成新的机器人孤岛；
- Agent 能跨入口 send/abort，未来按证据增加 steer；长任务断线后可恢复，高风险副作用可审批、审计和对账；
- Provider、Tool 协议、工作流和 Trace 技术可以替换，而 Notebook、学习历史和授权不跟着框架迁移。

相对 OpenClaw，第二代目标达到其“单 Gateway、多客户端/渠道、长期会话、工具、审批、compaction、远程控制”的核心产品层级；不追求短期复制其 provider/channel/plugin 数量，也不复制单操作者和宿主机执行信任模型。EduCanvas 的差异化是 Web-first K12、共享 Notebook、多 Actor 隔离和可信教育 Domain。

## 后果

正面后果：入口能力不再漂移；外部框架可以替换；教育能力不再等于第二 Runtime；恢复、审计与隐私边界可独立验证。

代价：迁移期需要兼容旧 Teaching/General 账本；Tool effect ledger、跨进程 continuation 和 Context 删除策略仍需生产设计；Hybrid Ports 比直接拼框架需要更多稳定契约，但避免把核心数据与权限绑定到外部生命周期。

## 接受门

本 ADR 当前保持 `proposed`。项目负责人确认后，才可改为 `accepted` 并创建第二代生产实施计划；确认前不得以本 ADR 为由修改生产 Schema 或迁移入口。
