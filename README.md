# 多模态K12人工智能通识课教学助手

本仓库用于开发浙江省大学生人工智能竞赛赛题 **JBGS-2026-02：多模态K12人工智能通识课教学助手对话智能体**。

项目目标：做一个面向小学到高中学生的AI教师。它能通过对话、动画、绘本、编程和游戏化练习进行教学，并根据学生的学习表现调整下一步内容。北极星目标：在缺少专业AI教师的情况下，学生仍能独立完成一节准确、有趣、可操作、有反馈的AI通识微课。

## 从哪里开始

- 产品、架构和研发文档：[docs/README.md](docs/README.md)
- 团队协作方法：[协作.md](协作.md)
- 官方赛题：[第二届浙江省大学生人工智能竞赛赛题细则](docs/00-overview/references/jbgs-2026-02-competition-rules.docx)

## 产品闭环

系统必须形成完整的教学闭环（详见 [docs/00-overview/project-brief.md](docs/00-overview/project-brief.md)）：

```text
选择学段或课程
→ 判断当前水平
→ 对话讲解与主动引导
→ Canvas互动学习
→ 练习或编程实践
→ 自动评价与反馈
→ 更新学生掌握度
→ 推荐下一步内容
```

示范主题为"AI如何识别猫和狗"：同一知识点分别用绘本、分类游戏、特征可视化和Python实验适配不同学段。

## 系统架构

> 架构全貌见 [docs/02-architecture/system-architecture.md](docs/02-architecture/system-architecture.md)（`draft`）。本节为速览，冲突时以 docs 为准。

### 设计原则

- Next.js只负责Web与BFF，不承载全部后端；核心API无状态化、可水平扩展；
- **教学正确性由确定性状态机和规则保证**，大模型只负责自然语言表达、内容组织和受控工具调用；
- **Canvas是受控组件运行时**：模型输出结构化Artifact，经白名单Schema校验后由预注册React组件渲染，绝不执行模型生成的任意HTML/JS/GSAP源码；
- PostgreSQL是业务事实源，Redis只放短期状态，长任务可重试可恢复；
- 所有模型调用和教学决策可追踪、可审计。

### 服务拆解（目标形态）

| 服务 | 职责 |
|---|---|
| `web` | Next.js页面、SSR、BFF和流式UI |
| `core-api` | 用户、课程、会话、权限和业务API |
| `realtime-gateway` | SSE、WebSocket和语音信令 |
| `teaching-runtime` | 教学状态机、工具调用和学生状态 |
| `retrieval-service` | 混合检索、重排和证据组装 |
| `ai-worker` | OCR、切块、Embedding和批处理 |
| `workflow-worker` | 教材处理、报告和再索引等长任务 |

基础设施：PostgreSQL + pgvector、PgBouncer、Redis、对象存储、Temporal（长流程编排）、OpenTelemetry（观测）；事件总线在学习事件量增长后接入。

### 教学状态机

教学流程由确定性状态机约束（[docs/03-ai/agent-orchestration.md](docs/03-ai/agent-orchestration.md)）：

```text
DIAGNOSE → EXPLAIN → DEMONSTRATE → PRACTICE → ASSESS → REMEDIATE / ADVANCE
```

模型在状态机内通过受控工具工作（`retrieveKnowledge`、`renderCanvas`、`generateQuiz`、`gradeAnswer`、`recommendNextNode`等），每个工具都有Schema校验、权限、超时、幂等和审计。LangChain不作为核心依赖，领域状态保存在自己的数据库中，不放在Agent框架内部。

## 技术拆解

### 前端（apps/web）

- **技术栈**：Next.js + React + TypeScript，Headless组件 + 自有设计系统（[ADR-0001](docs/09-decisions/0001-core-stack.md)，`accepted`）；
- **学习页三栏布局**：AI教师对话 | 教学Canvas | 学习进度，让"教师引导—动手理解—学习反馈"始终同时可见；
- **动画统一使用GSAP**：`@gsap/react` + `useGSAP()`、独立scope、卸载时回收Timeline、不在SSR阶段执行；动画Artifact支持播放/暂停/跳转/步进/重置/变速，关键节点产生学习事件（[docs/02-architecture/canvas-and-gsap.md](docs/02-architecture/canvas-and-gsap.md)，`accepted`）。

### 受控Canvas协议（packages/canvas-protocol）

项目核心安全设计（[ADR-0002](docs/09-decisions/0002-controlled-canvas.md)，`accepted`）：

- 模型输出结构化Artifact JSON，经**白名单Zod判别联合**（strict模式）校验后，由预注册React组件渲染；
- 协议规划10种Artifact类型（`story_book`、`concept_card`、`step_animation`、`classification_game`、`sorting_game`、`quiz`、`code_lab`、`image_observation`、`project_task`、`learning_summary`），阶段一先实现 `classification_game` 和 `quiz`；
- 协议版本随Artifact持久化，支持旧会话回放时选择兼容的校验与渲染逻辑。

### AI层（规划中，状态`draft`）

- **模型路由**（[docs/03-ai/model-routing.md](docs/03-ai/model-routing.md)）：不用一个最强模型处理所有请求，按任务质量/延迟/成本/模态路由——意图识别用Flash级、日常教学用Plus级、离线高价值生成用Max级（当前候选为Qwen系列），跨供应商容灾；业务代码不写死模型ID，统一经Model Gateway（别名、重试、熔断、配额、Fallback、Trace）；
- **RAG检索**（[docs/03-ai/rag-embedding.md](docs/03-ai/rag-embedding.md)）：学段/教材/知识点过滤 → 查询改写 → 全文召回 + pgvector向量召回 → RRF融合 → Reranker → 返回证据、页码和置信度；
- **Embedding治理**：每个向量空间必须记录模型、版本、维度、指令和切块版本，不同模型即使维度相同也不混用同一空间；模型迁移走双写、回填、Shadow、灰度、保留回滚窗口的流程；
- **教材切块**：保留教材/年级/章节/知识点结构，父子块策略，图片保存OCR与多模态向量，公式代码表格不被无意义截断。

### 数据层（packages/db）

PostgreSQL + Drizzle ORM，pgvector承载向量检索（[docs/04-data/data-design.md](docs/04-data/data-design.md)，`draft`）。原则：Redis丢失不能导致学习历史丢失；掌握度用结构化字段计算，不让大模型凭感觉决定；未成年人数据最小化收集。

阶段一最小表集（[ADR-0003](docs/09-decisions/0003-phase1-monorepo-and-drizzle.md)，`accepted`）：

| 表 | 职责 |
|---|---|
| `lesson_sessions` | 教学会话与状态机当前状态 |
| `canvas_artifacts` | 已通过白名单校验的Artifact快照，供回放与审计 |
| `learning_events` | 只追加的学习事实流，掌握度重算的可追溯输入 |
| `mastery_states` | 学生×知识节点的掌握度（分数、次数、误区标签、乐观锁） |

`users`、`courses`、`knowledge_nodes`、`embedding_spaces`等完整实体在阶段二引入。

## 仓库结构

pnpm workspace + Turborepo monorepo：

```text
EduCanvas/
├── apps/
│   └── web/                  # Next.js学生端应用；开发页面、对话区或教学Canvas前先读这里的README。
├── packages/
│   ├── canvas-protocol/      # Canvas Artifact与学习事件的共享协议；新增教学组件或事件前必须先看。
│   └── db/                   # Drizzle表结构、数据库连接和迁移；涉及持久化数据时必须先看。
├── docs/                     # 保留00到10编号的共同事实源；方案、原始赛题和跨模块约定从其README进入。
├── CLAUDE.md                 # AI agent的工作规则入口；让agent改仓库前必须先读。
├── 协作.md                    # 面向队友的Git/GitHub操作指南；第一次参与或准备提交PR时查看。
├── docker-compose.yml        # 本地PostgreSQL与pgvector环境；启动或排查数据库时使用。
├── package.json              # 仓库统一命令和Node/pnpm约束；不知道命令从哪里跑时查看。
├── pnpm-workspace.yaml       # pnpm工作区范围；新增应用或共享包时需要更新。
├── turbo.json                # Turborepo任务依赖与缓存规则；调整build、lint或typecheck流程时查看。
└── tsconfig.base.json        # 全仓库TypeScript基础约束；修改编译规则时查看。
```

其余根目录文件（`.editorconfig`、`.prettierrc`、`.nvmrc`、`.gitattributes`、`.github/`等）为格式与CI约定，普通功能开发通常不用动。

## 快速开始

```bash
# 环境要求：Node >= 22（见 .nvmrc）、pnpm 10、Docker
cp .env.example .env        # 默认值开箱即用，真实 .env 绝不提交
pnpm install
pnpm db:up                  # 启动本地 PostgreSQL + pgvector
pnpm db:migrate             # 应用数据库迁移
pnpm dev                    # 启动开发服务（turbo dev）
```

其他常用命令：`pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm db:generate`（生成迁移）。

## 当前进度

按[路线图](docs/10-planning/roadmap.md)分四个阶段：产品纵切 → 平台化 → 生产强化 → 竞赛交付。

当前处于**阶段一（产品纵切）**：monorepo骨架、受控Canvas协议v1（`classification_game`/`quiz`）、阶段一最小表集和`/learn`三栏布局已落地；AI对话链路、教材RAG、GSAP动画、Python实验、掌握度更新和状态机运行时尚未实现。

## 最简单的团队协作规则

1. `main`是稳定分支，不直接修改。
2. 每项工作先创建自己的分支。
3. 完成后推送分支并创建Pull Request。
4. 至少让一位队友检查后再合并。
5. 产品、接口或技术决策发生变化时，同时更新`docs/`。
