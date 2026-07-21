# EduCanvas 项目技术与架构报告

- 报告状态：`archived snapshot`（停止维护）
- 最后核对日期：2026-07-16
- 核对分支：`feat/20260716-multimodal-platform`
- 仓库形态：pnpm + Turborepo 模块化单体
- 当前产品阶段：本地可运行的真实 Agent/K12 垂直纵切，正在进入通用平台解耦阶段
- 事实来源：当前仓库代码、Package Manifest、Drizzle Schema、已接受 ADR 与 active plan

> 本报告只保存2026-07-16当日视图，路径、测试数和实现边界可能已经过时。当前事实请查阅[`docs/README.md`](../../README.md)、已接受ADR与`packages/db/src/schema.ts`。

## 1. 项目结论

EduCanvas 的平台定位是一个 **Chat-first、资产化、可扩展的全模态 AI 工作空间**：

- Chat 是主要交互入口；
- PDF、图片以及未来的音频、视频和网页是可复用知识资产；
- Canvas 承载可交互 Artifact；
- Studio 管理可持续编辑、版本化和复用的输出；
- K12 AI 教师是当前首个垂直 Agent，而不是整个平台的唯一产品定义。

当前代码已经越过“UI 原型”阶段，具备真实 Provider SSE、消息与运行账本、受控工具循环、资产上传、引用链路、确定性 Canvas 判分、可信教学状态推进、有界跨轮历史与上下文快照，以及首个通用 Space/Conversation 数据骨架。它仍然是一个 **K12 纵切驱动的模块化单体**；通用消息尚未接入真实 Turn Engine，摘要/Artifact 上下文、原生图片/音视频模型输入、Artifact 生命周期和真正插件装配仍未完成。

架构健康度可以概括为：

| 维度 | 当前判断 | 说明 |
| --- | --- | --- |
| 模块化 | 良好 | Web、协议、领域、运行时、Provider 与数据库已经拆包 |
| 领域隔离 | 良好 | 教学状态、掌握度、可信事件位于 `teaching-core` |
| Provider 解耦 | 基础完成 | 领域只依赖 `TurnModelGateway`，供应商 SSE 留在适配器 |
| 通用 Agent Runtime | 部分完成 | `agent-runtime` 已做 Asset/Conversation Context，Turn/Tool 编排仍在 `teaching-runtime` |
| 数据通用性 | 部分完成 | Agent/Asset 表存在，但仍借用 `lesson_sessions` 作为 Space/Conversation |
| 多模态 | 资产层部分完成 | PDF 和图片可上传；当前 Provider 输入仍是文本，图片不能被模型原生理解 |
| Artifact 安全 | 良好 | Zod 白名单协议 + 静态 React Renderer，不执行模型生成的任意代码 |
| 插件能力 | 尚未形成 | Provider、Tool、Artifact Renderer 仍是编译期闭集 |
| 生产就绪 | 未达到 | 正式认证、租户、生产治理、受控 live smoke、完整 E2E 尚未完成 |

## 2. 当前产品形态

### 2.1 平台能力

平台希望形成以下闭环：

```mermaid
flowchart LR
    U[用户在 Chat 表达意图] --> C[组织消息与多模态上下文]
    C --> A[Agent 选择模型与受控工具]
    A --> R[流式回答或提出 Artifact]
    R --> I[用户确认、交互、编辑]
    I --> P[持久化消息、资产、产物与 Trace]
    P -.继续对话.-> U
```

当前真正落地的是其中的 Chat、PDF 文本上下文、受控工具、引用、预置 Canvas 和 K12 状态投影。通用 Artifact proposal、Studio 版本管理以及原生全模态 Provider 输入仍在后续阶段。

### 2.2 K12 垂直 Agent

当前 `/learn` 是平台的首个完整业务验证面：

1. 匿名用户开始或恢复学习会话；
2. 用户在 Chat 提问，也可以附加 PDF 或图片 Asset；
3. 后端恢复可信身份和课程 Session；
4. Agent 直接回答，或调用当前教学状态允许的工具；
5. 工具执行后由模型进行第二次 synthesis；
6. 引用、消息、Model Run、Tool Call 与安全决策分别持久化；
7. Canvas 交互由服务端判分；
8. 只有可信事件才能更新掌握度与教学状态。

这条纵切证明了平台的协议和运行边界，但其中的课程状态、学生身份表达和 Progress 不应反向进入通用 Chat/Asset/Artifact 核心。

## 3. 当前实现阶段

### 3.1 已实现

- Next.js Chat-first 学习页和深色 Ambient Halo；
- 匿名身份、HttpOnly Cookie、Session 创建与恢复；
- EduCanvas 自有 SSE v1，而不是直接透传供应商事件；
- OpenAI-compatible 原生 `fetch + SSE` Provider Adapter；
- DeepSeek 本地/开发环境显式启用和生产禁用策略；
- Answer → Tool → Synthesis 的两阶段 Agent Turn；
- 消息、Message Parts、Model Runs、Tool Calls、安全决策的持久化账本；
- 单 Session 活动 Turn、幂等、租约、heartbeat、显式取消和过期收敛；
- PDF/图片 Asset、不可变 Asset Version 与私有 Storage Key；
- PDF 文本物化，图片不支持时诚实拒绝而不是伪装理解；
- PostgreSQL FTS、Source Snapshot、Retrieval Candidate 和 Citation；
- `classification_game`、`quiz`、`pipeline_flow` 三种受控 Artifact；
- 服务端确定性判分、可信学习事件、掌握度投影和状态机；
- 单元、PostgreSQL integration、Playwright E2E 与视觉快照基础设施。

### 3.2 部分实现

- `agent-core` 已通用化，`agent-runtime` 已包含 Asset Context 与 Conversation Context Builder，但通用 Turn/Tool Engine 尚未迁入；
- Answer Prompt 已装配有界历史对话，选择证据写入 `turn_context_snapshots`；摘要、记忆和 Artifact 上下文仍未实现；
- 图片已经作为 Asset 保存，但没有进入模型的原生视觉输入；
- 上传 Asset 和审核 Knowledge Source 是两条并行链路；
- Citation 可验证来自候选白名单，但尚未绑定最终回答的具体 claim/span；
- Studio 和 Rail 已有 UI 入口，但真实 Artifact 列表/版本生命周期未完成；
- Canvas Renderer 安全，但还是编译期注册表，不是可信插件运行时。

### 3.3 尚未实现

- 通用 `Operation / Model Run / Message Parts` 全量迁移（`Space / Conversation / Message` 骨架已落地）；
- 跨轮摘要、长期记忆和 Artifact 上下文装配；
- 原生图片、音频、视频 Provider 输入；
- Provider Capability Registry 与动态路由；
- 通用 Tool/Policy/Agent Profile 插件协议；
- Artifact proposal、确认、独立生成任务、版本和真实 Studio；
- 正式用户体系、多租户、学校/班级权限与跨设备恢复；
- 生产 Provider 审批、内容治理、备份恢复、SLO 和灰度发布。

## 4. 技术栈

下表版本来自当前 `package.json` 和 Docker Compose，而不是泛化建议。

| 层 | 技术 | 当前版本/形态 | 用途 |
| --- | --- | --- | --- |
| Runtime | Node.js | `>=22` | Web、BFF、Workspace Package 运行时 |
| Monorepo | pnpm | `10.33.0` | Workspace 依赖和锁文件 |
| Task runner | Turborepo | `2.10.4` | build、lint、test、typecheck 编排 |
| Web | Next.js App Router | `16.2.10` | Server Component、Route Handler、Server Action、BFF |
| UI | React / React DOM | `19.2.7` | Chat、Drawer、Canvas、Progress UI |
| Language | TypeScript | `5.9.3` | 严格类型、跨包协议 |
| CSS | Tailwind CSS | `4.3.2` | 设计 Token 与组件样式 |
| Motion | GSAP / `@gsap/react` | `3.15.0` / `2.1.2` | Halo、Sheet、Canvas Timeline |
| Validation | Zod | `4.4.3` | API、Model Event、Tool、Artifact、Domain Event Schema |
| Database | PostgreSQL | pgvector PostgreSQL 16 镜像 | 业务事实、FTS、未来向量检索 |
| ORM | Drizzle ORM | `0.45.2` | Schema、Repository 与迁移 |
| Driver | postgres.js | `3.4.9` | PostgreSQL 连接 |
| PDF | unpdf | `1.6.2` | PDF 文本解析 |
| Unit test | Vitest | `4.1.10` | Package 与 Web 单元/契约测试 |
| E2E | Playwright | `1.61.1` | Chromium 全栈、可访问性和视觉验证 |
| Icons/Font | Phosphor Icons / Inter Variable | `2.1.10` / `5.2.8` | UI 视觉系统 |

当前没有将 LangChain、LangGraph、Redis、Temporal、Kafka 或独立 Python 服务作为运行依赖。它们只能在真实负载和长任务需求出现后按边界引入。

## 5. Monorepo 总体架构

### 5.1 当前依赖结构

```mermaid
flowchart LR
    Browser[浏览器] --> Web[apps/web\nNext.js + BFF]
    Web --> AC[agent-core\n通用契约]
    Web --> AR[agent-runtime\nAsset Context]
    Web --> CP[canvas-protocol\n受控 Artifact]
    Web --> TR[teaching-runtime\nK12 Turn/Tool/判分]
    Web --> MG[model-gateway\nProvider Adapter]
    Web --> DB[db\nDrizzle Repositories]
    AR --> AC
    MG --> AC
    TR --> AC
    TR --> TC[teaching-core\n状态机/事件/掌握度]
    TR --> CP
    DB --> AC
    DB --> TC
    DB --> CP
    DB --> PG[(PostgreSQL)]
```

当前属于“模块化单体”：部署时 Web/BFF 和 Package 运行在同一 Node.js 应用中，但业务规则和基础设施通过 Package 与 Port 隔离。现阶段不需要为了形式上的“独立后端”提前拆微服务。

### 5.2 目标依赖方向

```mermaid
flowchart TB
    Shell[Platform Shell / BFF] --> Runtime[通用 Agent Runtime]
    Runtime --> Core[Chat / Asset / Artifact Core]
    Runtime --> Providers[Provider Adapters]
    Runtime --> Persistence[PostgreSQL Adapters]
    Runtime --> Processors[Asset Processors / Retrieval]
    K12[K12 Vertical Agent] --> Runtime
    K12 --> Teaching[教学状态 / 判分 / Progress]
```

目标不是一次性重写，而是把当前 `teaching-runtime` 中通用的 Turn/Tool/Context 逐步上移到 `agent-runtime`，让 K12 只注入 Agent Profile、工具、策略和领域投影。

## 6. 一次真实对话如何运行

```mermaid
sequenceDiagram
    participant U as Browser
    participant R as Turn Route
    participant B as Web BFF
    participant O as Turn Orchestrator
    participant M as Model Gateway
    participant T as Tool Executor
    participant D as PostgreSQL

    U->>R: POST /api/v1/learn/turn
    R->>R: Same-origin + JSON Schema
    R->>B: beginOwnedTeachingTurn(identity, parts)
    B->>D: 恢复 Session、校验 Asset、beginOrReplay
    B->>O: streamTurn(trustedStudentId, command)
    O->>M: phase=answer
    M-->>O: text_delta 或 tool_call
    alt 需要工具
        O->>T: Schema/状态/权限/超时/幂等校验
        T-->>O: 受控工具结果
        O->>M: phase=synthesis，无工具
        M-->>O: 最终 text_delta
    end
    B->>D: 写消息、Model Run、Tool Call、引用和终态
    B-->>U: EduCanvas SSE v1
```

关键设计点：

- 浏览器不能提交可信学生 ID、Session ID、模型 ID 或私有 Storage Key；
- 浏览器断连不等于用户取消，显式取消使用独立 Route；
- Provider 最多执行 Answer 和可选 Synthesis 两次；
- 工具由“当前状态允许 × 已注册 Handler × 对模型暴露”共同决定；
- Tool Result 不直接作为最终回答，必须回注模型 synthesis；
- Provider 的原始错误、推理内容和供应商事件不会进入浏览器。

### 6.1 浏览器可见 SSE 事件

当前 `schemaVersion=1` 支持：

```text
turn.accepted
message.delta
message.citation
tool.started
tool.completed
tool.failed
turn.completed
turn.failed
turn.cancelled
```

`artifact.proposed` 等事件尚未实现，应在 Artifact Runtime 合并后以 additive 方式增加。

## 7. 资产、知识与引用链路

当前存在两条相关但尚未统一的链路。

### 7.1 用户 Asset 链路

```text
Upload Route
  -> Asset ownership
  -> immutable AssetVersion
  -> private storage key
  -> PDF text extraction / image native reference
  -> AgentMessagePart reference
  -> refresh recovery
```

PDF 会被解析成文本加入当前 Prompt。图片会保存不可变引用，但当前文本 Provider 不接收原生图片，因此后端会返回明确的不支持错误。

### 7.2 Knowledge/Retrieval 链路

```text
KnowledgeSource
  -> KnowledgeDocument
  -> KnowledgeChunk
  -> SessionSourceBinding
  -> TurnSourceSnapshot
  -> RetrievalCandidate whitelist
  -> MessageCitation
```

当前检索基于 PostgreSQL FTS。候选白名单可以阻止模型伪造不存在的引用，但候选集合还不等价于“最终回答确实使用了这些证据”。后续需要把 Citation 绑定到实际 candidate、message part 或 claim/span。

## 8. Canvas 与可信判分

EduCanvas 当前明确拒绝直接执行模型生成的 HTML、JavaScript 或 GSAP。模型只能生成严格 Artifact 数据：

```ts
export const artifactSchema = z.discriminatedUnion('type', [
  classificationGameArtifactSchema,
  quizArtifactSchema,
  pipelineFlowArtifactSchema,
]);
```

运行路径如下：

```mermaid
flowchart LR
    JSON[结构化 Artifact JSON] --> Z[Zod 白名单校验]
    Z --> Registry[静态 React Renderer Registry]
    Registry --> UI[Canvas 交互]
    UI --> Action[Server Action]
    Action --> Ownership[身份/Session/Artifact 校验]
    Ownership --> Grade[确定性判分]
    Grade --> Event[可信学习事件]
    Event --> Projection[掌握度与状态投影]
```

公开题面保存在 `canvas_artifacts`，答案保存在物理分离的 `canvas_artifact_grading_keys`。浏览器永远不读取判分键。

GSAP 只用于可信 Renderer 内已注册的动画行为。模型不能传入 selector、duration、ease、Timeline 指令或源代码。

## 9. K12 教学状态与可信事件

K12 状态机持久化五个状态：

```text
DIAGNOSE -> EXPLAIN -> DEMONSTRATE -> PRACTICE -> ASSESS
```

评估结束后根据可信掌握度决定 remediation 或 advance，但 `REMEDIATE/ADVANCE` 不是持久化教学状态。

状态转移不会接受模型直接给出的 `targetState`。模型或工具最多提出封闭候选信号，例如 `PRACTICE_COMPLETED`；Runtime 再结合练习数量、服务端判分、历史事件和课程策略进行 guard。

```ts
if (from === 'PRACTICE' && to === 'ASSESS') {
  if (request.practiceEventCount < request.minimumPracticeEvents) {
    return { ok: false, from, to, code: 'INSUFFICIENT_PRACTICE' };
  }
  return { ok: true, from, to };
}
```

因此下面这些内容都不能直接修改掌握度或状态：

- 模型生成的文字；
- 浏览器自报分数；
- 未校验的 Canvas 事件；
- Tool 原始输出；
- React 本地状态。

## 10. 数据库设计

PostgreSQL 当前是唯一业务事实源，共 20 张主要业务表。

| 逻辑层 | 表 | 作用 |
| --- | --- | --- |
| K12 Session | `lesson_sessions` | 当前课程、教学状态、中断状态、版本和事件序号 |
| Asset | `assets` | 所有权、临时 Space、范围、类型和生命周期 |
| Asset | `asset_versions` | 不可变版本、hash、Storage Key、解析结果 |
| Chat | `chat_messages` | 学生/助手消息、流式终态、幂等、取消和 lease |
| Chat | `agent_message_parts` | text、asset reference、artifact reference |
| Trace | `model_runs` | Provider、模型、Prompt、usage、latency、终态 |
| Trace | `tool_calls` | 工具输入摘要、权限、结果和终态 |
| Safety | `turn_safety_decisions` | 输入/输出安全决策审计 |
| Knowledge | `knowledge_sources` | 可选知识来源 |
| Knowledge | `knowledge_documents` | Source 的不可变文档版本 |
| Knowledge | `knowledge_chunks` | 检索与引用 Chunk |
| Knowledge | `session_source_bindings` | Session 显式绑定来源 |
| Knowledge | `turn_source_snapshots` | Turn 使用的来源快照 |
| Knowledge | `turn_source_versions` | 快照中的具体 Source Version |
| Retrieval | `retrieval_candidates` | 本轮允许引用的候选白名单 |
| Citation | `message_citations` | 用户可见引用投影 |
| Canvas | `canvas_artifacts` | 浏览器安全的 Artifact 快照 |
| Canvas | `canvas_artifact_grading_keys` | 私有答案与评分键 |
| Learning | `learning_events` | 只追加可信事实流 |
| Learning | `mastery_states` | 学生×知识节点掌握度投影 |

当前最大的数据架构问题是通用对象仍以 `lesson_sessions` 为父实体。目标迁移为：

```text
Space
├── Conversations
│   ├── Messages / MessageParts
│   └── Operations / ModelRuns / ToolCalls
├── Assets / AssetVersions / Representations / Chunks
├── Artifacts / ArtifactVersions
└── VerticalContexts
    └── K12 LessonSession / Mastery / TrustedEvents
```

迁移必须采用新增表、回填、兼容读、收紧约束的 additive 路线，不能直接破坏现有纵切。

## 11. 安全与可靠性边界

### 11.1 已实现的安全边界

- 匿名 bearer 只保存在 HttpOnly、SameSite Cookie；数据库只保存派生身份；
- 所有写 Route 进行 same-origin 校验；
- 请求体、字符串、SSE 帧、事件数和累计文本有上限；
- Asset 归属和版本在服务端重新校验；
- API Key 只从服务端环境变量读取，禁止 `NEXT_PUBLIC_*`；
- Provider 异常映射为稳定错误码；
- DeepSeek 默认关闭，并禁止在 staging/production 解析；
- Tool 输入输出使用 Schema、状态、权限、超时和幂等控制；
- Model Run、Tool Call 和安全决策分别审计；
- Canvas 只使用白名单 Artifact；
- 掌握度只来源于可信事件；
- 无 Provider 时返回诚实失败，不回退到脚本回答。

### 11.2 尚需强化

- 正式认证、CSRF 策略、账号恢复和权限模型；
- 学校/班级/教师/学生租户边界；
- 未成年人数据保留、导出、更正、删除和危机升级流程；
- 上传文件恶意内容、Prompt Injection 与压缩炸弹扫描；
- 对象删除 Outbox 和残留巡检；
- Provider Fallback、熔断、容量、成本和健康路由；
- OpenTelemetry、SLO、备份、PITR 和灾难恢复。

## 12. 根目录与配置文件作用

| 文件/目录 | 作用 |
| --- | --- |
| `README.md` | 项目入口、产品定位、当前能力和快速启动 |
| `PROJECT_TECHNICAL_REPORT.md` | 当前项目、架构、技术栈、文件职责和关键代码总览 |
| `CLAUDE.md` | Claude 类 Agent 的仓库协作入口 |
| `.nvmrc` | CI 和本地 Node 主版本 `22` |
| `.editorconfig` | UTF-8、LF、两空格等跨编辑器基础格式 |
| `.prettierrc` | TypeScript/JSON 的 Prettier 风格 |
| `.gitignore` | Secret、依赖、构建、上传和测试输出忽略规则 |
| `.gitattributes` | Git 文件属性与换行行为 |
| `.github/workflows/ci.yml` | checks → PostgreSQL integration → Chromium E2E 三段 CI |
| `.github/CODEOWNERS` | 当前所有路径由仓库负责人审核 |
| `.github/pull_request_template.md` | PR 说明、验证、风险和 Secret 自查模板 |
| `.vscode/settings.json` | 团队格式化、TypeScript SDK 和文件排除设置 |
| `.vscode/extensions.json` | ESLint、Prettier、Tailwind 推荐扩展 |
| `Makefile` | 本地开发统一入口：setup、dev、check、integration、e2e |
| `package.json` | 根 Workspace scripts、Node/pnpm 版本和公共开发依赖 |
| `pnpm-workspace.yaml` | 声明 `apps/*` 与 `packages/*` Workspace |
| `pnpm-lock.yaml` | 锁定完整依赖图，保证可复现安装 |
| `turbo.json` | Monorepo build/test/typecheck 任务依赖和缓存策略 |
| `tsconfig.base.json` | Workspace TypeScript 公共编译选项 |
| `docker-compose.yml` | 本地 pgvector/PostgreSQL 16 数据库 |
| `.env.example` | 无 Secret 的环境变量模板 |
| `playwright.config.ts` | E2E 服务启动、浏览器和快照配置 |
| `apps/` | 可部署应用；当前只有 Next.js Web |
| `packages/` | 通用协议、领域、运行时、Provider 和持久化模块 |
| `docs/` | canonical 产品、架构、数据、工程、质量、ADR 和计划文档 |
| `tests/e2e/` | 全栈交互、视觉和 Canvas E2E |
| `output/playwright/` | 本地生成的截图和报告，不是业务源代码 |

## 13. `apps/web` 文件职责

### 13.0 应用配置

| 文件 | 作用 |
| --- | --- |
| `package.json` | Next.js 应用依赖和 dev/build/lint/test/typecheck scripts |
| `next.config.ts` | 固定 Turbopack Workspace 根、允许本地 HMR Origin、转译内部源码 Package |
| `tsconfig.json` | Web TypeScript 选项与 `@/` 路径别名 |
| `eslint.config.mjs` | Next.js Core Web Vitals 与 TypeScript ESLint 配置 |
| `postcss.config.mjs` | Tailwind CSS v4 PostCSS 插件 |
| `vitest.config.ts` | Web 单元测试解析和 `@/` 别名 |
| `next-env.d.ts` | Next.js 自动生成的类型声明入口，不手工编辑 |
| `README.md` | Web 应用的局部开发说明 |

### 13.1 App Router

| 文件 | 作用 |
| --- | --- |
| `app/layout.tsx` | 根 HTML、字体和全局页面壳 |
| `app/page.tsx` | 项目入口页 |
| `app/globals.css` | Tailwind、颜色 Token、深色主题和 Halo 样式 |
| `app/learn/page.tsx` | Server Component；读取匿名 Session，选择 LessonEntry 或 LearnWorkspace |
| `app/learn/actions.ts` | 创建/恢复学习会话、提交 Canvas 的 Server Actions |
| `app/learn/error.tsx` | 学习页错误边界 |
| `app/api/v1/learn/turn/route.ts` | Turn POST、身份恢复、请求校验、SSE Response |
| `app/api/v1/learn/turn/[turnId]/cancel/route.ts` | 显式取消 Turn |
| `app/api/v1/assets/route.ts` | Asset 查询与上传入口 |
| `app/design-qa/pipeline-flow/page.tsx` | 受控动画的 QA 页面 |
| `app/design-qa/design-qa-gate.ts` | 限制 QA Route 的访问条件 |

### 13.2 Chat 与 Composer

| 文件 | 作用 |
| --- | --- |
| `features/chat/messages.ts` | 浏览器消息、附件和 Citation 显示类型 |
| `features/chat/turn-events.ts` | 严格解析 EduCanvas SSE v1，限制帧、事件和文本上限 |
| `features/chat/turn-state.ts` | 纯 Reducer；管理 sending/streaming/completed/failed/cancelled |
| `features/chat/use-teaching-turn.ts` | 发起 Turn、消费 SSE、停止和重试 |
| `features/chat/chat-panel.tsx` | 消息列表、引用、重试和可访问性播报 |
| `features/chat/demo-teacher-script.ts` | 仅测试/显式 Demo 使用的脚本替身，生产路径禁止导入 |
| `features/chat/production-boundary.test.ts` | 防止生产 Chat 重新依赖 Demo Script |
| `features/composer/composer.tsx` | 主输入框、发送、停止、附件入口 |
| `features/composer/plus-menu.tsx` | 上传和受控工具菜单、键盘导航 |

### 13.3 Workspace 与辅助面板

| 文件 | 作用 |
| --- | --- |
| `features/workspace/learn-workspace.tsx` | 当前 K12 页面级状态容器，协调 Chat/Rail/Assets/Canvas/Progress |
| `features/workspace/lesson-entry.tsx` | 尚无匿名 Session 时的开始学习入口 |
| `features/workspace/empty-chat-hero.tsx` | S0 空对话首屏 |
| `features/workspace/ambient-halo.tsx` | GSAP 驱动的低频环境光，遵守 reduced-motion |
| `features/workspace/learning-rail.tsx` | 最近会话、Studio、Progress 导航 Rail |
| `features/workspace/learning-rail-model.ts` | Rail 的纯数据模型与选择逻辑 |
| `features/workspace/top-bar.tsx` | 顶部品牌/上下文栏 |
| `features/workspace/sheet.tsx` | 移动端 Drawer/Sheet |
| `features/workspace/modal-focus.ts` | Dialog 焦点循环与归还 |
| `features/assets/asset-upload-panel.tsx` | PDF/图片上传交互 |
| `features/assets/assets-drawer.tsx` | 当前 Space 的真实 Asset 列表和选择 |
| `features/assets/asset-client.ts` | 浏览器 Asset API 调用与类型收敛 |
| `features/progress/progress-drawer.tsx` | 服务端 Progress 投影 UI |
| `features/studio/studio-drawer.tsx` | Studio UI 壳；真实 Artifact 生命周期尚未完成 |

### 13.4 Canvas

| 文件 | 作用 |
| --- | --- |
| `features/canvas/canvas-registry.tsx` | Artifact type 到可信 React Renderer 的编译期映射 |
| `features/canvas/canvas-panel.tsx` | 桌面分栏/移动 Dialog Canvas 容器 |
| `features/canvas/animation-shell.tsx` | 受控 Timeline 播放器 |
| `features/canvas/animation-shell-model.ts` | 播放、暂停、步进和 reduced-motion 状态模型 |
| `features/canvas/pipeline-flow-fixture.ts` | Pipeline Artifact 的可信 Fixture |
| `features/canvas/pipeline-flow-qa.tsx` | Pipeline 视觉与交互 QA |

### 13.5 服务端组合根

| 文件 | 作用 |
| --- | --- |
| `server/anonymous-identity.ts` | 匿名 token 生成、hash、Cookie 读写 |
| `server/learning-session.ts` | Session bootstrap、查询、Canvas 提交与 Progress DTO |
| `server/learning-turn.ts` | 当前 Turn 大型组合根：账本、lease、replay、工具、引用、安全、终态 |
| `server/model-runtime.ts` | 从环境解析并创建 Provider Runtime |
| `server/audited-model-gateway.ts` | 包装 Gateway，持久化 Model Run 与归一化终态 |
| `server/teaching-runtime.ts` | 创建教学服务和数据库适配器 |
| `server/teaching-tools.ts` | 注册当前 K12 只读工具 Handler |
| `server/teaching-observability.ts` | 教学 Trace 与日志辅助 |
| `server/asset-upload.ts` | 上传验证、版本创建和内容处理 |
| `server/asset-storage.ts` | 私有磁盘/对象存储抽象的当前本地实现 |
| `server/asset-materialization.ts` | 将 Asset parts 转成当前文本模型上下文 |
| `server/turn-request.ts` | Turn JSON 大小、字段和 parts Schema 校验 |
| `server/turn-abort-registry.ts` | 进程内 AbortController 注册与显式取消 |
| `server/request-security.ts` | same-origin、稳定 JSON Error、Retry-After |
| `server/sse.ts` | EduCanvas SSE 编码与 Response Headers |
| `server/prompt-hash.ts` | 规范化 Prompt 材料并生成审计 hash |
| `server/demo-lesson.ts` | 当前 K12 演示课程初始化数据 |

`server/learning-turn.ts` 功能完整但职责过宽，是后续抽取通用 `StartTurnService / RunTurnService / ReplayTurnService` 的首要位置。

## 14. `packages` 文件职责

每个 Workspace Package 都包含 `package.json`（依赖和 scripts）、`tsconfig.json`
（严格类型检查）与 `README.md`（局部边界说明）。同目录的 `*.test.ts` 验证
Schema、纯函数和依赖边界；下表重点展开业务源文件。

### 14.1 `packages/agent-core`

通用、供应商无关的 Agent 契约层。

| 文件 | 作用 |
| --- | --- |
| `src/asset-contracts.ts` | Asset、Version、归属、状态和不可变引用 Schema |
| `src/message-contracts.ts` | text/asset/artifact Message Parts 与请求 Schema |
| `src/model-contracts.ts` | ModelAlias、消息、Tool、流事件、usage、错误与 metadata |
| `src/model-gateway.ts` | `TurnModelGateway` 与 `StructuredModelGateway` Port |
| `src/index.ts` | Package 公共导出 |
| `src/dependency-boundary.test.ts` | 防止通用核心依赖 K12、Web 或 Provider |

关键 Port：

```ts
export interface TurnModelGateway {
  streamTurnText(
    request: StreamAgentTextRequest,
  ): AsyncIterable<TurnModelEvent>;
}
```

该接口是 Provider 可替换的基础，但当前 `ModelMessage.content` 仍是字符串，尚未表达原生视觉或音视频 Part。

### 14.2 `packages/agent-runtime`

| 文件 | 作用 |
| --- | --- |
| `src/asset-context.ts` | 从 Message Parts 收集 Asset 引用并构造上下文材料 |
| `src/index.ts` | 公共导出 |
| `src/dependency-boundary.test.ts` | 保证只依赖 `agent-core` |

这个 Package 名称代表目标方向，但当前还不是完整 Agent Runtime；Turn、Tool、Policy 和 Context Snapshot 仍需迁入。

### 14.3 `packages/model-gateway`

| 文件 | 作用 |
| --- | --- |
| `src/config.ts` | Provider 环境配置、DeepSeek 环境限制、模型 Alias 映射 |
| `src/sse.ts` | 供应商 SSE data 读取与协议上限 |
| `src/openai-compatible-turn-model-gateway.ts` | 原生 OpenAI-compatible 流式 Adapter |
| `src/testing/openai-compatible-fixtures.ts` | CI 契约 Fixture，不调用真实外部模型 |
| `src/dependency-boundary.test.ts` | 保证 Adapter 只依赖通用 Agent 契约 |

Adapter 会验证 response ID、resolved model、fingerprint、usage、finish reason、Tool Call 分片和 `[DONE]`，并把异常收敛为稳定 `NormalizedModelError`。

### 14.4 `packages/canvas-protocol`

| 文件 | 作用 |
| --- | --- |
| `src/artifact.ts` | Artifact 白名单联合和版本 |
| `src/artifacts/classification-game.ts` | 分类游戏参数 Schema |
| `src/artifacts/quiz.ts` | 测验参数 Schema |
| `src/artifacts/pipeline-flow.ts` | Render-only 流程动画 Schema |
| `src/events.ts` | 浏览器 Canvas Interaction Event Schema |
| `src/grading.ts` | 服务端确定性判分 |
| `src/public-artifact.ts` | 去除私有答案后的浏览器 DTO |
| `src/server.ts` | 仅服务端允许导入的协议能力 |

新增 Artifact 的正确方式是增加 Schema、Renderer、交互协议、验证和测试，而不是让模型写组件代码。

### 14.5 `packages/teaching-core`

纯 K12 领域层。

| 文件 | 作用 |
| --- | --- |
| `src/state-machine.ts` | 教学状态、候选信号、转移 Guard 和中断恢复 |
| `src/domain-events.ts` | 可信学习事件信封和 producer 约束 |
| `src/mastery.ts` | 掌握度计算 |
| `src/learning-projection.ts` | 事件回放、误区与下一节点投影 |
| `src/tools.ts` | K12 工具名称、状态白名单和 exposure |
| `src/ports.ts` | Repository、Retriever、Clock 等领域 Port |
| `src/safety-policy.ts` | 确定性 K12 输入/输出安全策略 |
| `src/model-contracts.ts` | 教学侧兼容导出，通用模型契约已迁至 agent-core |

该包不能依赖 React、Next.js、Drizzle 或具体 Provider。

### 14.6 `packages/teaching-runtime`

K12 应用服务层。

| 文件 | 作用 |
| --- | --- |
| `src/turn-orchestrator.ts` | Answer/Tool/Synthesis 两阶段编排和模型流验证 |
| `src/tool-executor.ts` | 工具注册、状态/Schema/权限/超时/幂等执行 |
| `src/grade-submission.ts` | 校验 Canvas 提交并生成可信判分事实 |
| `src/state-transition.ts` | 从可信候选信号推进状态并追加事件 |
| `src/teaching-safety.ts` | K12 Safety Policy 应用服务 |
| `src/observability.ts` | 运行 Trace 端口和观测辅助 |
| `src/testing/scripted-model-gateway.ts` | 只用于测试的确定性 Gateway |
| `src/provider-boundary.test.ts` | 防止供应商类型泄漏进 Runtime |

两阶段核心逻辑：

```ts
if (answer.toolCalls.length === 0) {
  return completedWithOneModelRun;
}

const batch = await toolExecutor.executeBatch(answer.toolCalls);
const synthesis = await modelGateway.streamTurnText({
  phase: 'synthesis',
  tools: [],
  toolResults: batch.results,
});
```

### 14.7 `packages/db`

| 文件/目录 | 作用 |
| --- | --- |
| `src/schema.ts` | 当前全部 Drizzle 表、约束和索引 |
| `src/client.ts` | 延迟创建 PostgreSQL/Drizzle Client |
| `src/learning-session-repository.ts` | Session 创建、归属、当前页快照 |
| `src/chat-repository.ts` | 消息幂等、lease、流式终态和历史读取 |
| `src/turn-ledger-repository.ts` | 在事务中创建/重放完整 Turn 账本 |
| `src/model-run-repository.ts` | Model Run 状态机和 metadata |
| `src/tool-call-repository.ts` | Tool Call 状态、权限和结果摘要 |
| `src/turn-lease-repository.ts` | 活动 Turn、heartbeat、取消和过期收敛 |
| `src/turn-safety-decision-repository.ts` | Safety Decision 审计 |
| `src/asset-repository.ts` | Asset 所有权、版本和生命周期 |
| `src/message-parts.ts` | Message Parts 与数据库行互转 |
| `src/knowledge-source-repository.ts` | Source、Document、Chunk 和 Session Binding |
| `src/knowledge-retrieval-repository.ts` | Snapshot、FTS Candidate 和 Citation 白名单 |
| `src/artifact-repository.ts` | 公开 Artifact 与私有判分键 |
| `src/teaching-adapters.ts` | teaching-core Port 的 Drizzle 实现 |
| `src/anonymous-data-lifecycle.ts` | 匿名数据保留与清理基础能力 |
| `drizzle/*.sql` | 版本化数据库迁移 |
| `drizzle/meta/*.json` | Drizzle Kit 生成的迁移快照和 journal，不手工改业务事实 |
| `drizzle.config.ts` | Schema 路径、迁移目录和数据库连接配置 |
| `vitest.config.ts` | 不依赖数据库的 Repository/生命周期单元测试配置 |
| `vitest.integration.config.ts` | Docker PostgreSQL 集成测试配置 |
| `*.integration.test.ts` | Docker PostgreSQL 上的事务、并发和约束验证 |

Repository 层是 Adapter，不应包含 UI 文案、Prompt 或 Provider 逻辑。

## 15. 测试文件与质量门禁

| 范围 | 文件/命令 | 验证内容 |
| --- | --- | --- |
| Unit | 各 Package `*.test.ts` | Schema、状态机、Tool、Gateway、Reducer、SSE |
| DB Integration | `packages/db/*.integration.test.ts` | PostgreSQL 事务、迁移、并发、租约、归属、引用 |
| E2E | `tests/e2e/learning-flow.spec.ts` | 学习页主交互和恢复 |
| Visual | `tests/e2e/learning-visual.spec.ts` | 空态、Drawer、Canvas、移动端与快照 |
| Canvas | `tests/e2e/pipeline-flow.spec.ts` | Timeline、键盘和 reduced-motion |
| Quality docs | `docs/06-quality/` | 测试、安全、隐私和视觉验收规则 |

常用门禁：

```bash
make check        # lint + typecheck + unit
make integration  # 隔离 PostgreSQL 集成测试
make e2e          # build + Playwright 全栈测试
make build        # production build
```

本报告随首个 Runtime/Data 整改增量复核后的结果为：lint、TypeScript typecheck、289 项单元测试、46 项 PostgreSQL integration、23 项 Chromium E2E 和 production build 通过；Markdown 相对链接亦已重新检查。

## 16. 本地运行方式

### 16.1 首次设置

```bash
cd /Users/tim/Documents/EduCanvas
cp .env.example .env
```

至少填写：

```dotenv
DATABASE_URL=postgresql://educanvas:educanvas@localhost:5432/educanvas
EDUCANVAS_DEPLOYMENT_ENV=local
MODEL_GATEWAY_PROVIDER=deepseek
MODEL_GATEWAY_ALLOW_DEEPSEEK=true
MODEL_GATEWAY_BASE_URL=https://api.deepseek.com
MODEL_GATEWAY_API_KEY=<your-key>
MODEL_GATEWAY_PRIMARY_MODEL=<explicit-model-id>
```

然后执行：

```bash
make setup
make dev
```

默认 Web 地址为 `http://localhost:3101`，PostgreSQL 为 `localhost:5432`。

### 16.2 停止服务

```bash
make stop
```

该命令停止数据库容器但保留数据卷。

## 17. 当前架构问题与优化优先级

### P0：对话完整性（已完成首个可运行增量）

- 已构建有消息数/字符预算的 `ConversationContextBuilder`；
- 已将最近完整历史和选择的 Asset 纳入 Prompt，并原子保存上下文快照；
- 已修复带 Asset parts 的失败重试；
- 已将 `length` 收敛为可重试 `output_limit`，未知 finish reason 进入协议失败；
- 待继续补充摘要、Artifact 上下文和引用 claim/span 对齐。

### P1：Space/Conversation 数据主干

- 新增一等 `spaces`、`conversations`、`operations`；
- 为现有 lesson session 回填默认 Space/Conversation；
- 将 `lesson_sessions` 降为 K12 Vertical Context；
- 消息角色从 `student/assistant` 迁移为通用 `user/assistant/tool/system`；
- 保持 additive migration 与兼容读。

### P2：通用 Agent Runtime

- 将通用 Turn/Context/Tool/Policy 从 `teaching-runtime` 提取到 `agent-runtime`；
- 将 `learning-turn.ts` 拆为 Start/Run/Replay 应用服务；
- 定义 Agent Profile、Tool Plugin、Policy Plugin 与 Capability Metadata；
- K12 只注入领域工具、状态策略和 Progress Projection。

### P3：全模态 Asset/Source/Provider

- 统一 AssetVersion 与 Knowledge Source/Representation/Chunk；
- 增加结构化 `ModelInputPart`；
- 增加图片、音频、视频 Provider Capability；
- Provider Router 根据模态、任务、安全和成本选择模型；
- 建立 OCR、Transcript、Thumbnail、Embedding 等异步 Processor。

### P4：Artifact Runtime 与 Studio

- 持久化 Proposal、Confirmation、Generation Job 和 Artifact Version；
- Artifact Generation 使用独立 Operation/Model Run；
- 增加生成状态 SSE 与刷新恢复；
- Studio 只展示服务端真实 Artifact；
- 保持 Schema-first 和可信 Renderer Registry。

### P5：Platform Shell 与产品定稿

- 从 `LearnWorkspace` 抽取通用 Platform Shell；
- Gemini 式 Chat 作为主叙事；
- NotebookLM 式 Assets/Source 管理作为知识层；
- Canvas 按用户请求或 Agent Proposal 展开；
- K12 课程、Progress 和掌握度通过 Vertical Slot 注入；
- 完成桌面、移动、键盘、reduced-motion 和低端设备视觉验收。

## 18. 何时拆独立后端

当前最优策略仍是保持模块化单体，先完成数据和 Runtime 解耦。出现以下可测条件时再拆：

- SSE 连接规模要求 Web 与 Agent Runtime 独立扩容；
- OCR、音视频、Slide 等任务需要长时间 Worker；
- Provider 并发、限流和故障域需要单独治理；
- Web 和后端由不同团队独立发布；
- 移动端、第三方客户端需要稳定公共 API；
- 数据库连接池和 Web Server 生命周期产生冲突。

届时可以沿现有 Port 抽出 `core-api`、`realtime-gateway`、`agent-runtime`、`artifact-runtime` 和 Worker，而不重写领域核心。

## 19. 最终判断

EduCanvas 当前已经具备一个可靠的真实 Agent 垂直纵切和正确的大部分安全边界，最有价值的资产不是某个页面，而是：

1. 供应商无关的模型/SSE 契约；
2. 可审计的消息、模型和工具账本；
3. 受控 Tool Loop；
4. Schema-first Canvas；
5. 可信事件驱动的 K12 状态与掌握度；
6. 模块化单体提供的渐进拆分路径。

当前最大风险不是“UI 不够漂亮”，而是把 K12 纵切误当成通用平台已经完成，或把持久化消息误当成真正的连续对话。下一阶段应先完成 P0 对话完整性和 P1 Space/Conversation 数据主干，再进入通用 Runtime、原生全模态和 Artifact Studio。这样最终产品才能真正形成 **Gemini 式主对话 + NotebookLM 式知识资产 + Gemini Canvas 式受控输出**，同时保持 EduCanvas 自己的 Agent、资产和安全架构。

## 20. 相关 canonical 文档

- [文档总入口](../../README.md)
- [产品定义](../../01-product/product-definition.md)
- [学生 UI 规格](../../01-product/student-ui-spec.md)
- [系统架构现状](../../02-architecture/01-系统架构现状.md)
- [Agent 编排边界](../../03-ai/01-Agent编排边界.md)
- [数据设计](../../04-data/data-design.md)
- [API 约定](../../05-engineering/api-conventions.md)
- [测试与评测](../../06-quality/testing-and-evaluation.md)
- [ADR 索引](../../09-decisions/README.md)
- [路线图](../../10-planning/roadmap.md)
- [Gemini + NotebookLM 产品复刻计划结档](../../plan/completed/2026-07-gemini-notebooklm-replica.md)
- [K12 纵切结档记录](../../plan/completed/2026-07-real-agent-learning-vertical-slice.md)
