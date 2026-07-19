# Gateway-first 个人 Agent 架构收口

- 状态：`completed`
- 负责人：项目负责人
- 完成时间：2026-07-19
- 关键决策：[ADR-0015](../../09-decisions/0015-education-centered-personal-agent-platform.md)、[ADR-0016](../../09-decisions/0016-gateway-clients-channels-and-nodes.md)、[ADR-0017](../../09-decisions/0017-unified-runtime-and-notebook-context.md)、[ADR-0018](../../09-decisions/0018-capability-trust-and-learning-evidence.md)、[ADR-0019](../../09-decisions/0019-modular-monolith-artifacts-and-durable-jobs.md)

## 目标与结果

目标是把EduCanvas从Web中心双循环教学应用演进为以教育能力为核心的通用个人Agent平台。结果：`gateway.v1`、User/Personal Agent/共享Notebook边界、云端Gateway组合根、Web兼容接入、唯一Agent Loop、TUI、Telegram私聊纵切和可选只读Capability Node均已落地；原Web/K12/Artifact行为保持回归通过。

## 已关闭范围

### D1/D2：产品、身份与协议

- [x] 教育能力为核心的通用个人Agent平台；
- [x] 云端Gateway、每用户逻辑隔离、一个自然人一个Personal Agent；
- [x] 家庭/班级通过私人/共享Notebook与显式Membership协作，不共享Agent身份；
- [x] Client/Channel/Node/Operator、Inbound Envelope、Event、错误、幂等、恢复和投递；
- [x] Actor/User/Agent/Notebook/Conversation/Channel Thread路由；
- [x] 能力风险、审批、到期与撤销；Web SSE明确为兼容投影。

### G0/G1：代码边界与Web

- [x] 保留`apps/ + packages/`顶层结构，新增的每个模块都有真实行为和边界测试；
- [x] `gateway-core`不导入Next.js、Drizzle、K12或Provider SDK；
- [x] `gateway-runtime`实现路由、指纹、幂等、事件持久化/恢复和单终态；
- [x] `apps/gateway`实现HTTP/NDJSON、Client/Node session、审批和安全指标；
- [x] Chat/Learn Route在服务端构造Gateway Envelope，匿名主体只作为显式兼容身份；
- [x] 历史切换、Sources/Studio隔离、引用、Artifact、可信判分、取消与刷新恢复行为等价。

### R1：唯一Agent Runtime

- [x] `AgentLoopEngine`唯一拥有模型/工具多圈、预算、取消、synthesis和终态；
- [x] General、K12与独立Gateway Runner只注入Profile/Prompt/工具/领域回调；
- [x] K12判分、可信事件、掌握度和可选结构化课程仍由确定性领域服务维护；
- [x] 仓库扫描和依赖测试未发现第二个生产循环。

### T1/C1/N1：第二入口、渠道和Node

- [x] TUI支持login、会话列表、Chat、status、resume、approvals、approve/deny；
- [x] Web与TUI Fixture经Gateway到达同一Notebook/Conversation；
- [x] Telegram私聊文本Adapter实现绑定、官方Update归一化、`update_id`幂等、Delivery账本和4096字符切分；
- [x] 群聊、bot、未知账号、媒体和渠道内高风险审批被明确拒绝；
- [x] Node实现出站配对、心跳、撤销、轮询/结果、`device.status`和allowlisted read；
- [x] traversal、绝对路径、symlink escape、过期、重放、撤销、Shell和写入均有拒绝证据。

## 数据与安全证据

- additive迁移0019–0021建立User/Agent/Membership/Grant、Channel/Delivery、Node、Operation Event和Approval；`pnpm db:generate`确认Schema无漂移；
- PostgreSQL集成测试覆盖共享contributor、viewer/非成员拒绝、Actor与个人Agent不混同、跨租户Operation隐藏、幂等冲突、Approval、Delivery去重和Node生命周期；
- Client principal只能由可信服务端边界构造；公共Client请求不能自报用户；
- Gateway transport默认关闭，所有服务密钥至少32字节；日志/指标不含正文、动态URL ID、token、Provider Secret或私有对象key；
- Node和Channel有依赖边界测试，不能导入Runtime/数据库或主机执行能力。

## 验收命令

2026-07-19在本地隔离数据库和production build上执行：

- `make check`：通过；
- `make integration`：通过；
- `make e2e`：35/35通过；
- `make build`：通过；
- `pnpm db:generate`：No schema changes。
- `pnpm audit --prod --audit-level moderate`：通过；审计发现的PostCSS中危传递依赖已用workspace override升级到修复版后清零。

E2E首轮发现教学Gateway兼容层把“AI老师无法连接”误映射为通用文案；修复Profile感知映射后全量重跑通过。Telegram offset也改为仅在Update成功处理后推进，避免处理失败时丢消息。

## 有意不在本计划伪装完成的事项

- 没有用户提供的Telegram Bot Token，因此只有官方协议形状Fixture和离线可执行验证，没有live发送证明；
- bootstrap token是管理员/本地建联凭据，不是正式IdP；
- 当前只开放L0/L1 Node能力。Approval记录/交互已实现，但没有开放批准后执行L2/L3动作；
- 正式认证、长期Context/记忆、原生多模态、外部观测/SLO、对象删除闭环和云部署转入路线图P0/P1。

## 已回写事实源

- [系统架构](../../02-architecture/system-architecture.md)
- [Gateway与多入口](../../02-architecture/gateway-and-channels.md)
- [Agent编排](../../03-ai/agent-orchestration.md)
- [数据设计](../../04-data/data-design.md)
- [API约定](../../05-engineering/api-conventions.md)
- [后端](../../05-engineering/backend.md)
- [安全与隐私](../../06-quality/security-and-privacy.md)
- [测试与评测](../../06-quality/testing-and-evaluation.md)
- [部署与可观测性](../../07-operations/deployment-and-observability.md)
- [路线图](../../10-planning/roadmap.md)
