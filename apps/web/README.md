# @educanvas/web

## 这个包是什么

这是 EduCanvas 当前唯一的 Web 应用。它使用 Next.js App Router 同时承载学生端 Chat-first 学习体验和阶段一 BFF/组合根，负责把 `@educanvas/teaching-core`、`@educanvas/teaching-runtime`、`@educanvas/model-gateway`、`@educanvas/canvas-protocol` 与 `@educanvas/db` 组装成可运行纵切。

共享协议、领域规则、应用用例和数据库定义不得复制到应用私有目录；阶段一保持模块化单体部署，边界依据 [ADR-0003](../../docs/09-decisions/0003-phase1-monorepo-and-drizzle.md)。当前身份仍是匿名演示身份，不是正式用户认证。

## 当前实现边界

已经接通：

- S0 空对话入口、S1 对话态，以及按需打开的桌面 Canvas 侧栏/移动端 Canvas 模态；Assets、Studio、Progress 使用互斥抽屉；
- 匿名课程启动、新建、恢复和最近学习记录；
- `POST /api/v1/learn/turn` 的 EduCanvas SSE、显式取消、失败收敛、消息历史与刷新恢复；
- 通过 `@educanvas/model-gateway` 注入真实 OpenAI-compatible Provider；未配置 Provider 时明确返回 unavailable，不回退到脚本回答；
- 两阶段 `answer -> tools -> synthesis` 教学轮次、当前唯一生产工具 `getStudentState`、输入/流式输出安全 Gate，以及消息、Model Run、Tool Call、Turn lease 和安全决策账本；
- 阶段一预置 `classification_game` 的公开渲染、服务端私有判分、掌握度更新和 Progress 回显；受控 `quiz` Renderer 与 render-only `pipeline_flow` Renderer 也已注册。

尚未接通：

- K1 审核资料、FTS、Turn 快照与引用仓储尚未接入生产工具、SSE 引用事件和引用 UI；
- T1 状态推进服务虽已在 `teaching-runtime` 实现，但 Canvas 判分后尚未由 Web 组合根调用，当前不会形成完整状态推进闭环；
- Studio 当前只展示本课预置产物状态；Artifact 的 Agent 提议、学生确认、独立生成和持久化列表尚未实现；
- `ScriptedModelGateway` 与 Demo Teacher Script 只用于测试，不属于生产回答路径。

因此，“Provider Adapter、SSE、账本、K1/T1 底层能力存在”不等于“真实 Provider 已完成线上验证”或“整节课 Agent 闭环已完成”。

## 核心文件导读

### 页面与 HTTP 边界

- `app/layout.tsx`：全站根布局、字体和默认元数据。
- `app/page.tsx`：项目首页入口。
- `app/learn/page.tsx`：加载匿名学习页快照，呈现课程启动页或学习工作区。
- `app/learn/actions.ts`：课程启动、新建、恢复与 Canvas 提交的 Server Action 边界，只返回公开 DTO。
- `app/api/v1/learn/turn/route.ts`：校验同源请求和匿名身份，创建教学 Turn 并返回 SSE。
- `app/api/v1/learn/turn/[turnId]/cancel/route.ts`：学生显式停止当前回答的接口。
- `app/design-qa/`：受环境闸门保护的设计验收页面，不是生产课程入口。
- `app/globals.css`：设计 Token、深色主题、Halo、工作区和 Canvas 样式。

### 学生端功能

- `features/workspace/learn-workspace.tsx`：Chat、Canvas、Rail 与抽屉的客户端总编排。
- `features/workspace/empty-chat-hero.tsx` 与 `ambient-halo.tsx`：S0 首屏和可降级光场。
- `features/chat/chat-panel.tsx`：消息、流式状态、停止和重试界面。
- `features/chat/use-teaching-turn.ts`：发送请求、消费 SSE、取消与重试状态管理。
- `features/chat/turn-events.ts` 与 `turn-state.ts`：浏览器 SSE 协议解析和 Turn 状态机。
- `features/composer/composer.tsx` 与 `plus-menu.tsx`：提问输入、发送/停止与能力入口。
- `features/canvas/canvas-panel.tsx`：桌面/移动端 Canvas 容器。
- `features/canvas/canvas-registry.tsx`：`classification_game`、`quiz`、`pipeline_flow` 的静态 React Renderer 注册表。
- `features/canvas/animation-shell.tsx`：受控动画播放、暂停、步进、速度和 reduced-motion。
- `features/assets/assets-drawer.tsx`、`features/studio/studio-drawer.tsx`、`features/progress/progress-drawer.tsx`：资料、产物和进度抽屉。
- `features/learning/learning-contracts.ts`：学习页、Canvas 提交和 Progress 的浏览器公开 DTO。

### 服务端组合根

- `server/anonymous-identity.ts`：匿名 Token 校验、哈希学生标识与 HttpOnly Cookie。
- `server/learning-session.ts`：课程启动/恢复、页面快照、聊天历史和 Canvas 判分编排。
- `server/learning-turn.ts`：Turn ledger、lease、模型/工具运行、安全 Gate、持久化与公开事件的总编排。
- `server/model-runtime.ts`：读取白名单环境变量并创建真实 `TurnModelGateway`。
- `server/audited-model-gateway.ts`：在 Provider 事件流外增加 Model Run 与 usage 审计。
- `server/teaching-tools.ts`：生产工具注册；当前仅有 `getStudentState`。
- `server/teaching-runtime.ts`：向 Canvas 判分服务注入 Drizzle 适配器。
- `server/turn-abort-registry.ts`：当前进程内的显式取消注册表。
- `server/request-security.ts`、`turn-request.ts`、`sse.ts`：同源写保护、请求边界与 SSE 编码。

## 常用命令

以下命令都从仓库根目录执行：

```bash
pnpm --filter @educanvas/web dev
pnpm --filter @educanvas/web test
pnpm --filter @educanvas/web typecheck
pnpm --filter @educanvas/web lint
pnpm --filter @educanvas/web build
```

本地纵切需要 PostgreSQL 和根目录 `.env`：

```bash
pnpm db:up
pnpm db:migrate
pnpm --filter @educanvas/web dev
```

浏览器验证从仓库根目录执行 `pnpm test:e2e`。Playwright 配置要求 `E2E_DATABASE_URL` 指向数据库名以 `_e2e` 或 `_test` 结尾的隔离实例，并会先构建生产应用；不要指向共享开发库或生产库。

## 改动前必读

- [产品定义](../../docs/01-product/product-definition.md)
- [学生端 UI 规格](../../docs/01-product/student-ui-spec.md)
- [Canvas 与 GSAP](../../docs/02-architecture/canvas-and-gsap.md)
- [智能体编排](../../docs/03-ai/agent-orchestration.md)
- [前端工程](../../docs/05-engineering/frontend.md)
- [API 约定](../../docs/05-engineering/api-conventions.md)
- [ADR-0003](../../docs/09-decisions/0003-phase1-monorepo-and-drizzle.md)
