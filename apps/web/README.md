# @educanvas/web

## 这个包是什么

这是 EduCanvas 当前唯一的 Web 应用。它使用 Next.js App Router 同时承载 Chat-first 体验和阶段一 BFF/组合根，负责把通用 `@educanvas/agent-core`、Provider、Artifact、数据能力与 K12 `@educanvas/teaching-core` / `@educanvas/teaching-runtime` 组装成当前首个可运行纵切。

共享协议、领域规则、应用用例和数据库定义不得复制到应用私有目录；项目继续采用模块化单体，边界依据 [ADR-0019](../../docs/09-decisions/0019-modular-monolith-artifacts-and-durable-jobs.md)。local deployment 下 Web 与 TUI 使用同一个 `local:owner` 主体；其他未接正式 IdP 的环境仍使用受限匿名兼容身份，不能冒充正式用户认证。

## 当前实现边界

已经接通：

- S0 空对话入口、S1 对话态，以及按需打开的桌面 Canvas 侧栏/移动端 Canvas 模态；Assets、Studio、Progress 使用互斥抽屉；
- 匿名课程启动、新建、恢复和最近学习记录；
- `POST /api/v1/learn/turn` 的 EduCanvas SSE、显式取消、失败收敛、消息历史与刷新恢复；
- 通过 `@educanvas/model-gateway` 注入真实 OpenAI-compatible Provider；未配置 Provider 时明确返回 unavailable，不回退到脚本回答；
- 两阶段 `answer -> tools -> synthesis` 教学轮次、生产工具 `getStudentState` / `retrieveKnowledge`、输入/流式输出安全 Gate，以及消息、Model Run、Tool Call、Turn lease 和安全决策账本；
- 通用PDF/图片Asset上传、匿名所有权、不可变版本、PDF文本物化、多Part消息、真实资产抽屉与刷新恢复；
- `/settings` 通信方式设置、provider-neutral Connections BFF、Telegram pending 授权与撤销；微信/QQ 无资格时明确 disabled；
- K1 PostgreSQL FTS、Turn快照、候选白名单、防伪引用持久化、SSE事件和引用UI；
- Canvas服务端判分后的受控状态推进；只有可信当前状态为`ASSESS`时才提交完成信号；
- 阶段一预置 `classification_game` 的公开渲染、服务端私有判分、掌握度更新和 Progress 回显；受控 `quiz` Renderer 与 render-only `pipeline_flow` Renderer 也已注册。

尚未接通：

- 当前OpenAI-compatible文本Provider不能原生理解图片；图片Asset会保留不可变引用并返回明确的模态不支持错误，不静默降级；
- T1非`ASSESS`节点的可信事件接线仍未完成，当前不会形成完整状态推进闭环；
- 原生图片、音频和视频模型输入、统一 Context Engine 与正式 IdP 尚未接通；
- `ScriptedModelGateway` 与 Demo Teacher Script 只用于测试，不属于生产回答路径。

因此，“Provider Adapter、SSE、账本、Asset/K1/T1首条纵切存在”不等于“真实Provider已完成线上验证”或“整节课Agent闭环已完成”。

## 核心文件导读

### 页面与 HTTP 边界

- `app/layout.tsx`：全站根布局、字体和默认元数据。
- `app/page.tsx`：项目首页入口。
- `app/learn/page.tsx`：加载匿名学习页快照，呈现课程启动页或学习工作区。
- `app/learn/actions.ts`：课程启动、新建、恢复与 Canvas 提交的 Server Action 边界，只返回公开 DTO。
- `app/api/v1/learn/turn/route.ts`：校验同源请求和匿名身份，创建教学 Turn 并返回 SSE。
- `app/api/v1/assets/route.ts`：校验同源请求和匿名身份，上传或列出当前主体拥有的Asset。
- `app/api/v1/learn/turn/[turnId]/cancel/route.ts`：学生显式停止当前回答的接口。
- `app/design-qa/`：受环境闸门保护的设计验收页面，不是生产课程入口。
- `app/settings/page.tsx` 与 `app/api/v1/connections/`：通信方式 GUI 与同源、可信身份 BFF。
- `app/globals.css`：「两支笔」设计 Token（黛青/朱砂、纸/砚墨双主题）、排版与 Canvas 样式。

### 学生端功能

- `features/workspace/general/`：通用Chat入口、工作区和建议提示。
- `features/workspace/learning/`：K12 Chat、Canvas、Rail与抽屉编排。
- `features/workspace/shared/`：两条工作区复用的品牌印章、批改笔迹、问候、Sheet和焦点管理。
- `features/chat/chat-panel.tsx`：消息、流式状态、停止和重试界面。
- `features/chat/use-teaching-turn.ts`：发送请求、消费 SSE、取消与重试状态管理。
- `features/chat/turn-events.ts` 与 `turn-state.ts`：浏览器 SSE 协议解析和 Turn 状态机。
- `features/composer/composer.tsx` 与 `plus-menu.tsx`：提问输入、发送/停止与能力入口。
- `features/canvas/canvas-panel.tsx`：桌面/移动端 Canvas 容器。
- `features/canvas/canvas-registry.tsx`：`classification_game`、`quiz`、`pipeline_flow` 的静态 React Renderer 注册表。
- `features/canvas/animation-shell.tsx`：受控动画播放、暂停、步进、速度和 reduced-motion。
- `features/assets/asset-client.ts`、`asset-upload-panel.tsx`与`assets-drawer.tsx`：真实Asset上传、选择和资料抽屉。
- `features/studio/studio-drawer.tsx`、`features/progress/progress-drawer.tsx`：产物和进度抽屉。
- `features/settings/connection-settings.tsx`：渠道 provider、pending/active/revoked 与撤销界面。
- `features/learning/learning-contracts.ts`：学习页、Canvas 提交和 Progress 的浏览器公开 DTO。

### 服务端组合根

- `server/identity/`：匿名 Token 校验、哈希学生标识与 HttpOnly Cookie。
- `server/http/`：同源写保护、请求/SSE边界和进程内取消注册表。
- `server/assets/`：上传解析、私有存储、PDF解析与Provider上下文物化。
- `server/model/`：Provider Runtime、审计Gateway与Prompt hash。
- `server/platform/`：通用Conversation与Turn组合根。
- `server/teaching/`：K12 Session、Turn、Tool、判分服务与可观测性组合根。

## 常用命令

以下命令都从仓库根目录执行：

```bash
make dev          # Web + worker，本地产品验证
make check        # lint、typecheck 与单元测试
make build        # 生产构建
make e2e          # 隔离数据库上的浏览器回归
```

本地纵切需要 PostgreSQL 和根目录 `.env`：

```bash
make dev
```

`make e2e` 要求 `E2E_DATABASE_URL` 指向数据库名以 `_e2e` 或 `_test` 结尾的隔离实例，并会先构建生产应用；不要指向共享开发库或生产库。

## 改动前必读

- [产品定义](../../docs/01-product/product-definition.md)
- [学生端 UI 规格](../../docs/01-product/student-ui-spec.md)
- [Canvas 与 GSAP](../../docs/02-architecture/canvas-and-gsap.md)
- [Agent 编排边界](../../docs/03-ai/01-Agent编排边界.md)
- [前端工程](../../docs/05-engineering/frontend.md)
- [API 约定](../../docs/05-engineering/api-conventions.md)
- [ADR-0019：模块化单体、Artifact 与持久任务](../../docs/09-decisions/0019-modular-monolith-artifacts-and-durable-jobs.md)
