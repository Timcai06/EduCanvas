# Web-first 入口、TUI 与连接控制面结档记录

- 状态：`completed`
- 负责人：项目负责人
- 完成时间：2026-07-21
- 关键决策：[ADR-0016](../../09-decisions/0016-gateway-clients-channels-and-nodes.md)

## 目标与结果

把 Gateway-first 基础演进为低摩擦的 K12 Web 主入口和高级 TUI 入口，并让两端操作同一主体、Notebook 与 Conversation。结果：`make all/dev/tui`、本地身份与默认 Personal Workspace、一次性跨客户端 handoff、provider-neutral Connections、Web 设置页和 TUI `/channels` 均已落地。

## 实际交付

- 三条 Make 入口支持服务复用、端口归属与本地启动；
- loopback local onboarding、短期 Client session 与默认 Personal Workspace 幂等创建；
- Web local identity 与 TUI registered identity 对齐；
- TUI→Web 使用两分钟 opaque token，PostgreSQL 保存摘要并原子消费；重放、过期、跨主体和非法 token 均拒绝；
- Web→TUI 复用统一主体与 Gateway Notebook 目录，不在 K12 主界面暴露终端入口；
- Gateway Client API、Web `/settings` 与 TUI `/channels` 复用 provider-neutral Connections 服务；
- Telegram 支持十分钟 pending、一次性 `/start` 确认、撤销与状态审计；微信/QQ 缺少正式资格时明确 disabled。

## 验收证据

2026-07-21 已验证：

- `make check`、`make integration`、`make build`、`make e2e` 全部通过；
- PTY 实跑 `/channels` 与 disabled provider 提示；
- 独立 Gateway HTTP dogfood 验证 Telegram `available -> pending -> revoked`；
- PostgreSQL 集成覆盖跨用户读取/撤销拒绝、handoff 过期、重放和并发消费；
- Web `/settings` 完成亮暗主题目检，浏览器 console 0 error / 0 warning。

真实 Telegram 账号发送仍因缺少用户凭据未验证，不计为完成证据。

## 未完成项去向

- enabled Channel Adapter 的启动、停止、重连和 degraded health 转入[路线图 P0](../../10-planning/roadmap.md)；
- 正式 IdP、session 撤销、密钥轮换、真实微信/QQ 与生产观测继续由路线图管理；
- 第二代架构不在本计划内实现，进入[研究与决策计划](../active/2026-07-second-generation-architecture-research.md)。

## 已回写事实源

- [核心用户流程](../../01-product/user-flows.md)
- [学生端 UI 规格](../../01-product/student-ui-spec.md)
- [Gateway、客户端、渠道与能力节点](../../09-decisions/0016-gateway-clients-channels-and-nodes.md)
- [项目路线图](../../10-planning/roadmap.md)
