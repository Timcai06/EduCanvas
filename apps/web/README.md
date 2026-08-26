# @educanvas/web

## 这个包是什么

这是 EduCanvas 当前唯一的 Web 应用。它使用 Next.js App Router 同时承载 Chat-first 体验和阶段一 BFF/组合根，负责把通用 `@educanvas/agent-core`、Provider、Artifact、数据能力与 K12 `@educanvas/teaching-core` / `@educanvas/teaching-runtime` 组装成当前首个可运行纵切。

共享协议、领域规则、应用用例和数据库定义不得复制到应用私有目录；项目继续采用模块化单体，边界依据 [ADR-0005](../../docs/09-decisions/0005-模块化单体产物与持久任务.md)。local deployment 下 Web 与 TUI 使用同一个 `local:owner` 主体；其他未接正式 IdP 的环境仍使用受限匿名兼容身份，不能冒充正式用户认证。

## 当前实现边界

已经接通：

- Web 用户名账号、昵称/私有头像、登录/退出、原子密码与 session 轮换，以及历史会话归档；
  local 部署的 Agent/Notebook 归属仍固定为 `local:owner`，账号只提供资料与凭据走查；
- S0 空对话入口、S1 对话态，以及按需打开的桌面 Canvas 侧栏/移动端 Canvas 模态；历史侧栏只切换 Notebook，当前 Notebook 的来源与产物统一进入 Studio 的“文件输入 / 内容输出”两级弧形轮盘；
- 显式学习者声明、Notebook Goal、短诊断、匿名课程启动、新建、恢复和最近学习记录；
- `POST /api/v1/learn/turn` 的 EduCanvas SSE、显式取消、失败收敛、消息历史与刷新恢复；
- 通过 `@educanvas/model-gateway` 注入真实 OpenAI-compatible Provider；未配置 Provider 时明确返回 unavailable，不回退到脚本回答；
- 两阶段 `answer -> tools -> synthesis` 教学轮次、生产工具 `getStudentState` / `retrieveKnowledge`、输入/流式输出安全 Gate，以及消息、Model Run、Tool Call、Turn lease 和安全决策账本；
- 通用PDF/图片Asset上传、匿名所有权、不可变版本、PDF文本物化、多Part消息、真实资产抽屉与刷新恢复；
- 头像档案抽屉内的通信方式设置、provider-neutral Connections BFF、Telegram pending 授权与撤销；微信/QQ 无资格时明确 disabled，旧 `/settings` 只作兼容重定向；
- K1 PostgreSQL FTS、Turn快照、候选白名单、防伪引用持久化、SSE事件和引用UI；
- Canvas服务端判分后的受控状态推进；只有可信当前状态为`ASSESS`时才提交完成信号；
- 阶段一预置 `classification_game` 的公开渲染、服务端私有判分、掌握度更新和 Progress 回显；受控 `quiz`、无网络 Python `code_completion` Renderer 与 render-only `pipeline_flow` Renderer 也已注册。

尚未接通：

- 当前OpenAI-compatible文本Provider不能原生理解图片；图片Asset会保留不可变引用并返回明确的模态不支持错误，不静默降级；
- T1非`ASSESS`节点的可信事件接线仍未完成，当前不会形成完整状态推进闭环；
- 主 Provider 的原生音频/视频输入、长期 Memory 与正式 IdP 尚未接通；图片可由已验证的独立 Vision Provider 承接，Turn Application 已统一使用 Context Engine 并记录 Context Snapshot；
- `ScriptedModelGateway` 与 Demo Teacher Script 只用于测试，不属于生产回答路径。

因此，“Provider Adapter、SSE、账本、Asset/K1/T1首条纵切存在”不等于“真实Provider已完成线上验证”或“整节课Agent闭环已完成”。

## 核心文件导读

### 页面与 HTTP 边界

- `app/layout.tsx`：全站根布局、字体和默认元数据。
- `app/page.tsx`：项目首页入口。
- `app/learn/page.tsx`：在学习计划、无答案短诊断与学习工作区三种服务端状态间切换。
- `app/learn/actions.ts`：计划创建、诊断、新建、恢复与 Canvas 提交的 Server Action 边界，只返回公开 DTO。
- `server/study/`：代码内受信课程版本、Goal/诊断应用服务与浏览器安全投影。
- `app/api/v1/learn/turn/route.ts`：校验同源请求和匿名身份，创建教学 Turn 并返回 SSE。
- `app/api/v1/learn/code-runs/route.ts`：只为当前受信编程练习启动有界、无网络的 Python 沙箱。
- `app/api/v1/assets/route.ts`：校验同源请求和匿名身份，上传或列出当前主体拥有的Asset。
- `app/api/v1/learn/turn/[turnId]/cancel/route.ts`：学生显式停止当前回答的接口。
- `app/design-qa/`：受环境闸门保护的设计验收页面，不是生产课程入口。
- `features/profile/profile-drawer.tsx`、`app/settings/page.tsx` 与 `app/api/v1/connections/`：头像入口内的通信方式 GUI、旧路由重定向与同源可信身份 BFF。
- `app/login`、`app/register`、`app/api/v1/auth/` 与 `server/auth/`：Web 账号界面、
  有界认证输入、版本化 scrypt、session 和 local-only 限流；生产共享限流仍是部署门禁。
- `app/globals.css` 保存「两支笔」设计 Token 与全局基础样式，`app/interactive-controls.css`
  保存跨页面控件视觉，`app/conversation-content.css` 保存消息、来源与流式占位排版，
  `app/effects.css` 只保存受控视觉效果参数。

### 学生端功能

- `features/assistant/`：桌面管理助手的浏览器面板与请求状态；服务端分类、预算与模型调用归 `server/assistant/`。
- `features/chat/`：跨通用与教学工作区复用的消息呈现、SSE Turn 状态和恢复；`features/composer/` 只拥有输入与能力入口。
- `features/workspace/general/`：通用Chat入口与工作区编排。
- `features/workspace/learning/`：K12 Chat、Canvas、Rail与抽屉编排。
- `features/workspace/shared/`：两条工作区复用的品牌印章、批改笔迹、问候、Sheet和焦点管理。
- `features/chat/chat-panel.tsx`：消息、流式状态、停止和重试界面。
- `features/chat/use-teaching-turn.ts`：发送请求、消费 SSE、取消与重试状态管理。
- `features/chat/turn-events.ts` 与 `turn-state.ts`：浏览器 SSE 协议解析和 Turn 状态机。
- `features/composer/composer.tsx` 与 `plus-menu.tsx`：提问输入、发送/停止与能力入口。
- `features/canvas/canvas-panel.tsx`：桌面/移动端 Canvas 容器。
- `features/canvas/canvas-registry.tsx`：受控教学 Artifact 的静态 React Renderer 注册表。
- `features/canvas/code-completion-renderer.tsx`：预置 Python 框架、运行结果与可信提交入口。
- `features/canvas/animation-shell.tsx`：受控动画播放、暂停、步进、速度和 reduced-motion。
- `features/assets/asset-client.ts`、`asset-upload-panel.tsx`与`assets-drawer.tsx`：真实Asset上传、选择和来源列表。
- `features/studio/option-wheel*`、`studio-workspace.tsx`：基于 React Bits OptionWheel 改造的受控两级轮盘，以及当前 Notebook 输入/输出工作台；`studio-drawer.tsx`仍服务待退休的独立学习页。
- `features/progress/progress-drawer.tsx`：学习进度抽屉。
- `features/settings/connection-settings.tsx`：渠道 provider、pending/active/revoked 与撤销界面。
- `features/learning/learning-contracts.ts`：计划、诊断、学习页、Canvas 提交和 Progress 的跨层浏览器安全 DTO。
- `features/study/`：学习入口的显式画像、目标表单和短诊断 UI，不进行年龄或性格推断。
- `features/voice/`：语音输入、实时语音会话、播放与 Live Voice 专属视觉；RippleDistortion 不是全局 UI primitive。

### 服务端组合根

- `server/identity/`：匿名 Token 校验、哈希学生标识与 HttpOnly Cookie。
- `server/assistant/`：桌面管理助手的服务端分类、模型预算与限流。
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

- [产品定义](../../docs/01-product/01-产品定义.md)
- [学生端 UI 规格](../../docs/01-product/02-学生界面规范.md)
- [统一 Canvas 工作面](../../docs/02-architecture/04-统一画布工作面.md)
- [Agent 编排边界](../../docs/03-ai/01-智能体编排边界.md)
- [前端工程](../../docs/05-engineering/03-前端工程.md)
- [API 约定](../../docs/05-engineering/01-接口约定.md)
- [ADR-0005：模块化单体、Artifact 与持久任务](../../docs/09-decisions/0005-模块化单体产物与持久任务.md)
