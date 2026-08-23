# EduCanvas repository guidance

EduCanvas 是以教育能力为核心的通用个人 Agent 平台：通用 Agent 是产品主体，教育通过受控能力接入，不创建第二套 Agent。本文件是所有自动化编码助手的仓库规则 canonical source；人类协作流程见 `docs/08-collaboration/03-团队协作指南.md`。

## Repository map and entry points

- `apps/web` 是 Next.js 浏览器应用与兼容 BFF；`apps/gateway` 拥有 `gateway.v1` HTTP 组合根；`apps/worker` 运行持久后台任务。
- `packages/agent-runtime` 拥有唯一 Agent Loop；`packages/model-gateway` 是唯一 Provider Adapter 边界；`packages/db` 拥有 Drizzle schema、migrations 与 repositories。
- `docs/00-overview` 至 `docs/09-decisions` 是 canonical 文档；`docs/plan` 是执行生命周期，`docs/research` 是验证中的证据，`docs/archive` 是历史核对，均不替代 canonical facts。
- `tooling/` 是内部实现；开发者入口是根 `Makefile` 与 `package.json` scripts，不应直接把内部工具命令写成日常工作流。

## Universal invariants

- Provider 响应是不可信输入，产生领域事件前必须验证。Provider keys、原始 body、Prompt 和 stack trace 不得进入浏览器响应、日志证据或领域层。
- 普通对话只使用一个 `AgentLoopEngine`；教学通过 Profile、Skills、Tools 与可信领域服务接入。教学状态机、掌握度和可信学习事件集中在 `packages/teaching-core`。
- `gateway.v1` 是多入口协议；Web 只保留第一方客户端与兼容投影。公共协议兼容变更必须显式版本化。
- PostgreSQL 是业务事实源；历史 migration 和生成的 `.next`、`dist` 不可手改。
- Canvas 主页面不得执行模型生成的任意 HTML/JS；探索型产物只在无 same-origin、默认禁网络的隔离 Runtime 中运行。
- Windows 启动状态属于仓库根；不得停止记录的 EduCanvas 进程树以外的进程。

## Working and delivery rules

1. 开始前确认干净的最新 `main`；在 `类型/YYYYMMDD-简短任务名` 分支工作。类型限 `feat`、`fix`、`docs`、`refactor`、`test`、`chore`。
2. 不直接 commit、push 或 force-push 到 `main`。使用独立、可回滚的 PR；标题与提交说明采用 `类型: 做了什么`，一次提交只表达一个变化。
3. PR 必须说明 Goal、Boundary、Evidence、Rollback 和 Non-goals；Code Owner 批准和 squash merge 规则以 GitHub 分支保护为准。
4. 不提交 `.env`、密钥、Token、私钥、学生个人信息、模型权重、构建产物、缓存或未获授权的教材/媒体。
5. 行为、接口、数据或重大技术选择变化时，更新对应 canonical 文档或 ADR；计划、研究与快照不得伪装为当前事实。

## Validation commands

- `pnpm env:check`：验证 `.env`，不打印密钥；`pnpm env:init`：从审阅模板创建且不覆盖现有 `.env`。
- `pnpm lint`：workspace lint 与 Prettier；`pnpm typecheck`：全量类型检查；`pnpm test:tooling`：跨平台边界测试；`pnpm file:check`：package、公开输出、文件治理与文档链接。
- `pnpm setup:local`：安装依赖、启动 PostgreSQL 并迁移。Windows 使用 `Start EduCanvas.cmd` 和 `Stop EduCanvas.cmd`；详细平台流程见 README。

## Code, documentation, and collaboration

- 注释只解释因果约束、安全边界、平台差异、缓存决策、兼容性、失败风险或 side effect，不重复语法；公共 API 文档必须与相邻 JSDoc 风格一致。
- 新增 workspace 前先更新 package policy；不要新增 `shared`、`common`、`utils`、`misc` 等泛化边界来规避既有所有权。
- 逻辑 Owner、公开入口和依赖例外以 `tooling/architecture/package-policy.json` 为准；不得扩大 public exports 或跨层依赖来方便实现。
- 需要委派实施时，拆分为小而独立的任务，明确文件所有权；共享工作树中不得回退他人改动。主代理保留架构、安全、兼容性、最终证据与发布决定。
