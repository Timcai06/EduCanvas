# Contributing to EduCanvas

谢谢你帮助 EduCanvas 变得更可靠。仓库采用模块化单体：先找到真实的 Owner 与稳定边界，再改动代码；不要以新 package、第二个 Agent Loop 或跨层导入来绕开现有设计。

## Before you start

1. 阅读根 [README](README.md)、[文档中心](docs/README.md) 和相关 ADR。
2. 先检查 `AGENTS.md`：它定义入口、Provider 安全边界、数据库所有权与 Windows 启动约束。
3. 在新分支上工作；一次 Pull Request 只解决一个可回滚的问题。

## Local workflow

```bash
pnpm env:init
make setup
make doctor
make dev
```

提交前按改动范围运行验证。所有 PR 至少运行：

```bash
pnpm file:check
pnpm lint
pnpm typecheck
pnpm test:unit
git diff --check
```

涉及可构建入口时运行 `pnpm build`；涉及真实浏览器路径时运行相应 E2E；涉及数据库时运行隔离的 integration 测试。请记录命令、退出码和未运行项目，不要以静态 fixture 或 UI 截图替代运行证据。

## Pull requests

使用仓库的 PR 模板，并完整填写：

- **Goal**：可观察的交付结果；
- **Boundary**：受影响 package、公共契约、数据和逻辑 Owner；
- **Evidence**：真实命令、结果与人工验收分别标注；
- **Rollback**：可逆单位或兼容路径；
- **Non-goals**：本 PR 明确不改变的内容。

提交信息使用简洁的祈使句，描述用户或工程结果，例如 `Document gateway ownership boundary`。不要把格式化、重命名或生成产物混入不相关功能改动。

## Boundaries that must remain true

- `packages/agent-runtime` 是唯一 Agent Loop；
- `packages/model-gateway` 是唯一 Provider Adapter 边界；Provider SDK 类型、原始 body 和密钥不能进入浏览器、领域或协议层；
- `packages/db` 拥有 Drizzle schema、migrations 和 repositories；历史 migration 不可手改；
- `gateway.v1` 是多入口协议，公共兼容变更必须显式版本化；
- 不提交 `.env`、密钥、真实用户资料、Provider 原始响应、Prompt、stack trace 或生成的 `.next` / `dist`。

## Documentation

行为变化要同步更新对应 canonical docs；重大技术选择先新增或替换 ADR。计划、研究和历史材料不是当前实现事实源，文档状态与归档规则见[文档维护规则](docs/08-collaboration/02-文档维护规则.md)。
