# Web-first 入口、TUI 与连接控制面

- 状态：`active`
- 负责人：项目负责人
- 最后验证时间：2026-07-21

## 目标

把 Gateway-first 基础演进为 K12 Web-first 的可用产品入口：`make all` 启动完整后台系统，`make dev` 进入 Web 验证，`make tui` 进入不要求手工 ID/Token 的交互式 TUI；Web/TUI 共享主体和 Notebook，并通过一次性 handoff 双向切换。渠道由 Web GUI 或 TUI 设置，正常回复继续确定性返回来源。

## 当前任务

- [x] 三条 Make 入口与服务复用/端口归属基础；
- [x] loopback local onboarding、短期 Client session、默认 Personal Workspace 幂等创建；
- [x] TUI 持续交互基础与自动本地登录；
- [x] Web local identity 与 TUI registered identity 对齐；
- [x] Web/TUI 一次性双向 handoff：TUI→Web 使用两分钟 opaque token，Web→TUI 复用同一主体与 Notebook 目录；
- [ ] provider-neutral Connections API、Web 设置页与 TUI `/channels`；
- [ ] enabled Channel Adapter 生命周期和 degraded health；
- [ ] PTY、E2E、安全复核和文档收口。

## 边界

- Telegram 仅为实验性 Adapter，不默认启动；
- 真实微信/QQ 需要平台资格与凭据，不以 fake adapter 冒充完成；
- local onboarding 只允许显式 local deployment + loopback，生产仍需正式 IdP；
- `make all` 不启动交互式 TUI、未启用 Adapter 或外部 Capability Node。

## 完成证据

完成前必须记录 `make check`、`make integration`、`make build`、`make e2e`、PTY smoke、Web/TUI 同 Notebook、handoff 重放/过期/跨用户拒绝和 Connections 状态一致性证据。
