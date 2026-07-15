# 多模态K12人工智能通识课教学助手

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-React_+_TS-black?logo=nextdotjs" alt="Next.js">
  <img src="https://img.shields.io/badge/PostgreSQL-pgvector-336791?logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/动画-GSAP-88CE02?logo=greensock&logoColor=black" alt="GSAP">
  <img src="https://img.shields.io/badge/monorepo-pnpm_+_Turbo-F69220?logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/赛题-JBGS--2026--02-blue" alt="赛题">
</p>

本仓库用于开发浙江省大学生人工智能竞赛赛题 **JBGS-2026-02：多模态K12人工智能通识课教学助手对话智能体**。

项目目标：做一个面向小学到高中学生的AI教师。它能通过对话、动画、绘本、编程和游戏化练习进行教学，并根据学生的学习表现调整下一步内容。

> **北极星目标**：在缺少专业AI教师的情况下，学生仍能独立完成一节准确、有趣、可操作、有反馈的AI通识微课。

## 从哪里开始

| 你想了解             | 入口                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| 产品、架构和研发文档 | [docs/README.md](docs/README.md)                                                                          |
| 团队协作方法         | [协作.md](协作.md)                                                                                        |
| 官方赛题             | [第二届浙江省大学生人工智能竞赛赛题细则](docs/00-overview/references/jbgs-2026-02-competition-rules.docx) |

## 产品闭环

系统必须形成完整的教学闭环（详见 [docs/00-overview/project-brief.md](docs/00-overview/project-brief.md)）：

```mermaid
flowchart LR
    A[选择学段或课程] --> B[判断当前水平]
    B --> C[对话讲解与主动引导]
    C --> D[Canvas互动学习]
    D --> E[练习或编程实践]
    E --> F[自动评价与反馈]
    F --> G[更新学生掌握度]
    G --> H[推荐下一步内容]
    H -.-> B
```

示范主题为**"AI如何识别猫和狗"**：同一知识点分别用绘本、分类游戏、特征可视化和Python实验适配不同学段。

## 系统架构

> [!NOTE]
> 架构全貌见 [docs/02-architecture/system-architecture.md](docs/02-architecture/system-architecture.md)（`draft`）。本节为速览，冲突时以 docs 为准。

### 设计原则

- Next.js只负责Web与BFF，不承载全部后端；核心API无状态化、可水平扩展；
- **教学正确性由确定性状态机和规则保证**，大模型只负责自然语言表达、内容组织和受控工具调用；
- **Canvas是受控组件运行时**：模型输出结构化Artifact，经白名单Schema校验后由预注册React组件渲染；
- PostgreSQL是业务事实源，Redis只放短期状态，长任务可重试可恢复；
- 所有模型调用和教学决策可追踪、可审计。

### 服务拆解（目标形态）

当前阶段一仍是 `apps/web + packages/*` 的模块化单体；下图是阶段二以后按负载和职责逐步拆分的目标形态，不代表这些服务已经实现。阶段一先用独立 workspace 包守住领域、协议和数据边界。

```mermaid
flowchart TB
    subgraph 客户端
        student[学生浏览器]
    end

    subgraph 应用层
        web["web<br/>Next.js页面 / SSR / BFF / 流式UI"]
        rtgw["realtime-gateway<br/>SSE / WebSocket / 语音信令"]
    end

    subgraph 领域服务
        coreapi["core-api<br/>用户 / 课程 / 会话 / 权限"]
        teaching["teaching-runtime<br/>教学状态机 / 工具调用 / 学生状态"]
        retrieval["retrieval-service<br/>混合检索 / 重排 / 证据组装"]
    end

    subgraph 异步处理
        aiworker["ai-worker<br/>OCR / 切块 / Embedding / 批处理"]
        wfworker["workflow-worker<br/>教材处理 / 报告 / 再索引"]
    end

    subgraph 基础设施
        pg[("PostgreSQL<br/>+ pgvector")]
        redis[("Redis<br/>短期状态")]
        oss[("对象存储")]
        temporal["Temporal<br/>长流程编排"]
    end

    student --> web
    student --> rtgw
    web --> coreapi
    rtgw --> teaching
    coreapi --> pg
    teaching --> retrieval
    teaching --> pg
    teaching --> redis
    retrieval --> pg
    aiworker --> pg
    aiworker --> oss
    wfworker --> temporal
    temporal --> aiworker
```

### 教学状态机

教学流程由确定性状态机约束（[docs/03-ai/agent-orchestration.md](docs/03-ai/agent-orchestration.md)），模型在状态机内通过受控工具工作：

```mermaid
stateDiagram-v2
    [*] --> DIAGNOSE: 开始课程
    DIAGNOSE --> EXPLAIN: 判定当前水平
    EXPLAIN --> DEMONSTRATE: 讲解完成
    DEMONSTRATE --> PRACTICE: 演示完成
    PRACTICE --> ASSESS: 练习完成
    ASSESS --> EXPLAIN: REMEDIATE / 针对误区重讲
    ASSESS --> PRACTICE: REMEDIATE / 补充针对性练习
    ASSESS --> [*]: ADVANCE / 推荐下一知识点
```

`REMEDIATE`和`ADVANCE`是 `ASSESS` 的出口决策，不是持久化状态；状态转移权属于教学运行时，不属于模型。

受控工具闭集和“状态 × 工具”白名单已经落地；工具参数Schema、权限执行器、超时/重试、幂等、限流和审计仍属于待实现的Agent运行时能力。LangChain不作为核心依赖，领域状态保存在自己的数据库中，不放在Agent框架内部。

## 技术拆解

### 前端（apps/web）

- **技术栈**：Next.js + React + TypeScript，Headless组件 + 自有设计系统（[ADR-0001](docs/09-decisions/0001-core-stack.md)，`accepted`）；
- **学习页三栏布局**：AI教师对话 | 教学Canvas | 学习进度，让"教师引导—动手理解—学习反馈"始终同时可见；
- **已接通首条浏览器纵切**：匿名学习会话、受控Canvas提交、服务端判分、PostgreSQL掌握度持久化与进度回显；AI教师对话仍是占位区；
- **GSAP是待接入的动画标准**：计划使用`@gsap/react` + `useGSAP()`、独立scope并在卸载时回收Timeline；当前尚未安装GSAP依赖或实现动画Artifact（[docs/02-architecture/canvas-and-gsap.md](docs/02-architecture/canvas-and-gsap.md)，`accepted`）。

### 受控Canvas协议（packages/canvas-protocol）

> [!IMPORTANT]
> 项目核心安全设计（[ADR-0002](docs/09-decisions/0002-controlled-canvas.md)，`accepted`）：**绝不执行模型生成的任意HTML/JS/GSAP源码**。模型生成的是教学语义和参数，不是代码。

```mermaid
flowchart LR
    llm["模型输出<br/>结构化Artifact JSON"] --> validate{"白名单Zod校验<br/>strict判别联合"}
    validate -- 通过 --> split["服务端拆分<br/>公开投影 / 私有判分键"]
    split --> registry["预注册React组件<br/>按type分派渲染"]
    split --> grading[("私有判分键")]
    validate -- 拒绝 --> reject["返回错误路径<br/>记录审计"]
    registry --> canvas["教学Canvas"]
    canvas -- 不可信交互 --> runtime["teaching-runtime<br/>确定性判分"]
    grading --> runtime
    runtime -- 可信事件 --> events[("learning_events")]
```

- 协议规划9种基础Artifact类型（`story_book`、`concept_card`、`classification_game`、`sorting_game`、`quiz`、`code_lab`、`image_observation`、`project_task`、`learning_summary`）和一组教学动画模板；当前已实现 `classification_game` 与 `quiz`，`pipeline_flow` 是阶段一待实现的首个动画模板；
- 阶段一使用编译期静态注册表，确保每种Artifact都有经过审核的Schema和Renderer；阶段二再增加版本兼容与平台化管理能力；
- 当前只实现协议版本 `1`；版本随Artifact持久化，后续新增版本时必须同时注册对应Validator和Renderer，才能回放旧会话。

### AI层（规划中，状态`draft`）

**模型路由**（[docs/03-ai/model-routing.md](docs/03-ai/model-routing.md)）：不用一个最强模型处理所有请求，按任务质量/延迟/成本/模态路由，统一经Model Gateway（别名、重试、熔断、配额、Fallback、Trace），业务代码不写死模型ID。

| 任务                     | 主选方向          |
| ------------------------ | ----------------- |
| 意图识别、查询改写       | Flash级模型       |
| 日常教学和Canvas结构生成 | Plus级模型        |
| 高价值课程离线生成与审核 | Max级模型         |
| 实时语音和视觉           | Omni Realtime     |
| 跨供应商文本容灾         | 第二供应商Flash级 |

**RAG检索**（[docs/03-ai/rag-embedding.md](docs/03-ai/rag-embedding.md)）：

```mermaid
flowchart LR
    q[问题分类] --> f[学段/教材/知识点过滤]
    f --> rw[查询改写]
    rw --> fts[全文召回]
    rw --> vec[pgvector向量召回]
    fts --> rrf[RRF融合]
    vec --> rrf
    rrf --> rerank[Reranker]
    rerank --> out[证据 + 页码 + 置信度]
```

**Embedding治理**：每个向量空间必须记录模型、版本、维度、指令和切块版本，不同模型即使维度相同也不混用同一空间；模型迁移走双写 → 回填 → Shadow → 灰度 → 保留回滚窗口的流程。教材切块保留教材/年级/章节/知识点结构，采用父子块策略，公式代码表格不被无意义截断。

### 数据层（packages/db）

PostgreSQL + Drizzle ORM 是当前业务数据底座；pgvector是已选定但尚未接入表结构与检索适配器的向量检索方向（[docs/04-data/data-design.md](docs/04-data/data-design.md)，`draft`）。原则：Redis丢失不能导致学习历史丢失；掌握度用结构化字段计算，不让大模型凭感觉决定；未成年人数据最小化收集。

阶段一最小表集的概念关系如下（不是完整物理Schema；字段与索引以 [`packages/db/src/schema.ts`](packages/db/src/schema.ts) 和[数据设计](docs/04-data/data-design.md)为准）：

```mermaid
erDiagram
    lesson_sessions ||--o{ canvas_artifacts : "产生"
    canvas_artifacts ||--|| canvas_artifact_grading_keys : "私有判分"
    lesson_sessions ||--o{ learning_events : "记录"
    learning_events }o--|| mastery_states : "重算依据"

    lesson_sessions {
        uuid id PK
        text student_id
        text grade_band
        text course_slug
        text state "状态机当前状态"
    }
    canvas_artifacts {
        uuid id PK
        uuid session_id FK
        text type
        text schema_version "协议版本随快照持久化"
        jsonb params "仅浏览器安全公开投影"
    }
    canvas_artifact_grading_keys {
        uuid artifact_record_id PK
        jsonb grading_key "仅服务端判分器读取"
    }
    learning_events {
        uuid id PK
        uuid session_id FK
        text event_type
        text idempotency_key
        integer sequence "会话内单调递增"
        jsonb payload
        timestamp occurred_at "只追加,不改写历史"
    }
    mastery_states {
        text student_id PK
        text knowledge_node_id PK
        real mastery_score
        jsonb misconception_tags
        integer version "乐观锁"
    }
```

`users`、`courses`、`knowledge_nodes`、`embedding_spaces`等完整实体在阶段二引入。

## 仓库结构

pnpm workspace + Turborepo monorepo：

```text
EduCanvas/
├── apps/
│   └── web/                  # Next.js学生端应用；开发页面、对话区或教学Canvas前先读这里的README。
├── packages/
│   ├── canvas-protocol/      # Canvas Artifact与客户端交互协议；新增教学组件或交互前必须先看。
│   ├── teaching-core/        # 状态机、掌握度、可信领域事件与Port；新增教学规则前必须先看。
│   ├── teaching-runtime/     # 服务端判分与教学事务编排；新增应用用例前必须先看。
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

<details>
<summary>其余根目录配置文件说明（普通功能开发通常不用动）</summary>

| 文件             | 用途                                         |
| ---------------- | -------------------------------------------- |
| `.editorconfig`  | 编辑器通用格式约定；出现缩进或换行差异时查看 |
| `.env.example`   | 环境变量模板；首次启动时复制为不提交的`.env` |
| `.gitattributes` | Git文本规范；排查跨系统换行问题时查看        |
| `.github/`       | CI、PR模板和Code Owner规则                   |
| `.gitignore`     | Git忽略规则；新增构建产物或缓存类型时查看    |
| `.nvmrc`         | 项目Node.js版本；本地或CI版本不一致时查看    |
| `.prettierrc`    | 代码格式化规则                               |
| `pnpm-lock.yaml` | 精确依赖版本锁；由pnpm更新，不要手工编辑     |

</details>

## 快速开始

```bash
# 环境要求：Node >= 22（见 .nvmrc）、pnpm 10、Docker
cp .env.example .env        # 默认值开箱即用，真实 .env 绝不提交
pnpm install
pnpm db:up                  # 启动本地 PostgreSQL + pgvector
pnpm db:migrate             # 应用数据库迁移
pnpm dev                    # 启动开发服务（turbo dev）
```

基础验证命令：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
TEST_DATABASE_URL=postgresql://educanvas:educanvas@localhost:5432/educanvas_integration pnpm test:integration
E2E_DATABASE_URL=postgresql://educanvas:educanvas@localhost:5432/educanvas_e2e pnpm test:e2e
```

集成测试和E2E必须使用独立测试数据库：集成库名以`_integration`或`_test`结尾，E2E库名以`_e2e`或`_test`结尾。`pnpm test:e2e`会先执行生产构建；其他常用命令包括`pnpm build`和`pnpm db:generate`（生成迁移）。

## 当前进度

按[路线图](docs/10-planning/roadmap.md)分四个阶段：

```mermaid
timeline
    title 项目路线图
    阶段一 产品纵切 : monorepo骨架 ✅ : Canvas协议基础 ✅ : teaching-core基础 ✅ : teaching-runtime判分基础 ✅ : 阶段一表集Schema ✅ : 匿名会话与归属校验 ✅ : 浏览器提交与持久化进度 ✅ : Playwright纵切E2E ✅ : AI对话链路 : 教材RAG : GSAP动画
    阶段二 平台化 : Artifact版本与管理 : 教材上传审核 : Model Gateway : Embedding版本管理 : 教师端
    阶段三 生产强化 : 容量测试 : 横向扩容 : 模型容灾 : 隐私流程 : 多租户
    阶段四 竞赛交付 : 演示路径 : 项目报告 : 评测结果 : 答辩材料
```

当前处于**阶段一（产品纵切）**：匿名高熵HttpOnly Cookie在数据库中映射为哈希学生标识；学习会话、公开Artifact和私有判分键可原子bootstrap；浏览器通过Server Action提交后，由教学运行时执行session归属校验、确定性判分，并持久化Canvas与Progress。当前基线为57个单元测试、8个真实PostgreSQL集成测试和4个Playwright E2E，CI按基础检查、集成测试、浏览器E2E三个job执行。

这仍是匿名演示纵切，不等同于正式用户认证。下一步是实现Turn Orchestrator、Model Gateway与状态感知工具执行，再接入教材RAG、SSE对话和首个GSAP动画；正式认证、迁移向下回退、备份恢复、生产可观测性与运维门禁仍待完成。

## 最简单的团队协作规则

1. `main`是稳定分支，不直接修改。
2. 每项工作先创建自己的分支。
3. 完成后推送分支并创建Pull Request。
4. 至少让一位队友检查后再合并。
5. 产品、接口或技术决策发生变化时，同时更新`docs/`。
