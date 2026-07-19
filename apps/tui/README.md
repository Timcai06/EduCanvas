# @educanvas/tui

EduCanvas 的第一方终端客户端。它只是 Gateway 的一扇窗口：不包含模型循环、
教学逻辑或数据库访问，所有状态（会话、审批、事件恢复）都以 Gateway 为准，
架构边界见 `docs/09-decisions/0016-gateway-clients-channels-and-nodes.md`。

界面遵循「两支笔」设计语言（与 Web 同一套语义）：黛青是讲课的笔（Agent
标识、常规活动），朱砂是批改的笔（审批、错误、需要注意的事）；对话是唯一
的视觉主体，框线只用于「请停下来看」的审批卡，装饰在窄终端与无色环境下
先于信息退场。

## 核心文件

- `src/index.ts` — 命令入口与交互式 REPL（对话、`/notebooks`、`/approve` 等）
- `src/renderer.ts` — Gateway 事件流 → 终端输出的翻译层（正文/工具/审批三层密度）
- `src/text.ts` — CJK 显示宽度、换行、对齐的纯函数层（排版禁止绕过它用 `length`）
- `src/theme.ts` — 两支笔 ANSI 语义色与 NO_COLOR/非 TTY 降级
- `src/banner.ts` / `src/render.ts` — 扉页印章、审批卡、工具行、完成落款线
- `src/session.ts` / `src/config.ts` — Gateway 会话建立与本地凭据

## 常用命令

```bash
pnpm dev              # 交互式 REPL（需要本地 Gateway）
pnpm dev ui-demo      # 不连 Gateway 的界面全状态走查（设计 QA）
pnpm test             # 渲染纯函数单测（宽度/换行/降级/卡片对齐）
pnpm typecheck
pnpm build            # 打包为 dist/index.js（bin: educanvas）
```

## 改动前必读

- `docs/01-product/student-ui-spec.md`（产品语言与状态语义）
- `docs/09-decisions/0016-gateway-clients-channels-and-nodes.md`（客户端边界）
- 颜色永远只是冗余强调：任何状态必须先由文字或符号表达，再上色。
