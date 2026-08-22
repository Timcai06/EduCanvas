# WS Web 搜索与研究来源真实环境验收

> 状态：`AWAITING_PROJECT_OWNER`
>
> 执行人：项目负责人 tim
>
> 自动化负责人：Codex

## 1. 证据边界

本记录只承接真实 Search Provider、真实公开网页和电脑浏览器的产品验收。PR 中的
fixture、单元测试、Playwright DOM 断言和 CI 只能证明确定性协议与回归边界，不能替代
真实 Provider 质量、网页可读性和桌面视觉结论。

WS08 已由 PR #402 合并到 `fd012c2a`：CI 的静态检查、单元测试、Worker integration、
Agent Eval、Secret Scan、Chromium E2E 与最终 checks 全绿。该证据证明实现与安全门禁，
不证明下列真实环境项目已经执行。

WS09 的确定性基线已覆盖内置搜索失败重试、多选批量导入、五来源/五引用投影
与引用的 Notebook Source/原网页双动作；本地 Chromium PR 冒烟 15/15 通过，
WS09 完整 Chromium 文件 3/3 通过。这些用例使用固定 fixture，仍不能充当
真实 Provider 或人工视觉证据。

## 2. 验收前提

- 使用仓库根目录当前 `main`，记录开始时的 SHA；
- `pnpm env:check` 通过，至少配置一个真实 Search Provider；
- 使用电脑桌面 Chromium，保持开发者工具 Network/Console 可查看；
- 测试 Notebook 不包含需要保留的生产资料；
- 不在记录中粘贴 API Key、Prompt、Provider Body、网页正文或 Cookie。

## 3. 项目负责人检查表

### A. 五链接批量导入

- [ ] 一次输入 5 个公开 HTTP(S) 链接；
- [ ] 每项独立显示成功或固定、可操作的失败原因；
- [ ] 成功项进入当前 Notebook Sources，失败项不产生伪来源；
- [ ] 刷新后成功项仍存在，重复导入不会产生不可解释的重复状态。

### B. 内置网站搜索

- [ ] 输入一个真实查询并看到 Provider-neutral 结果；
- [ ] 多选至少 3 条结果并批量导入；
- [ ] 不可读、登录墙、限流或格式失败显示稳定错误；
- [ ] 浏览器响应与 Console 不出现 Provider Key、原始 Body、Prompt 或堆栈。

### C. Deep Research

- [ ] 提问“光合作用的研究进展”；
- [ ] 观察至少 3 次成功搜索；
- [ ] 最终持久化至少 5 个真实来源；
- [ ] 报告包含至少 5 个有效引用，且不足时诚实失败而非伪造达标；
- [ ] 刷新或短暂断线后恢复同一 Operation，不重复来源或引用序号。

### D. 引用、删除与追问

- [ ] 逐一点击 5 个引用，均打开正确的 Notebook Source；
- [ ] 每个 Web 引用均有独立“打开原网页”动作；
- [ ] 删除一个研究来源后刷新，来源不复现；
- [ ] 历史报告中的引用仍保留审计定位；
- [ ] 后续追问不再把已删除来源选入新上下文。

### E. 视觉与交互结论

- [ ] 桌面 Chromium 下搜索、批量选择、导入进度、研究进度和错误状态清晰；
- [ ] 来源列表、引用动作、删除确认和刷新恢复无明显遮挡、跳动或误导；
- [ ] 项目负责人确认整体体验可接受，或记录阻塞问题与复现步骤。

## 4. 签署

- 开始 SHA：`PENDING`
- Search Provider：`PENDING`（只记录 Provider 名，不记录 Key）
- 执行日期：`PENDING`
- 结论：`PENDING`
- 阻塞问题：`PENDING`
- 项目负责人签署：`PENDING`

只有本节由 tim 回写为明确 `PASS`，WS09 才能标记通过并将 WS 计划移入
`docs/plan/completed/`。未执行项不得由自动化结果代签。
