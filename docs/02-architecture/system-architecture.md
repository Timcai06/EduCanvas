# 系统架构

- 状态：`draft`

## 设计原则

- EduCanvas平台本体是通用全模态Chat、Assets、Agent Runtime、Artifact Runtime和Studio；K12教学是首个垂直Agent；
- 通用模型、消息、工具、资产、Artifact和运行Trace协议不得依赖教学状态、掌握度或课程概念；
- 阶段一采用模块化单体，Next.js同时承载Web与BFF；领域逻辑必须留在独立workspace包中；
- 阶段二以后Next.js回归Web与BFF，不承载全部后端；
- 核心API无状态化，可水平扩展；
- 模型调用、检索、实时连接和长任务相互隔离；
- PostgreSQL是业务事实源；
- Redis只保存短期状态；
- 长任务必须可重试、可恢复；
- 所有模型调用和教学决策可追踪。

## 能力分层

```mermaid
flowchart TB
    web["Chat-first Web"] --> agent["通用Agent能力<br/>消息 / 模型 / 工具 / Trace"]
    web --> assets["通用Assets<br/>附件 / 长期资产 / 版本 / 检索"]
    web --> artifacts["通用Artifact Runtime<br/>提议 / 确认 / 生成 / Studio"]
    k12["K12 AI教师Agent<br/>课程 / 状态机 / 掌握度 / 判分"] --> agent
    k12 --> assets
    k12 --> artifacts
    agent --> gateway["Provider Gateway"]
    agent --> db[(PostgreSQL)]
    assets --> db
    artifacts --> db
```

平台层只提供通用执行与数据能力；垂直Agent选择工具、领域策略和专用Artifact。K12的可信学习事件可以驱动掌握度，但不能成为通用消息或Artifact协议的前置条件。

## 当前阶段一：模块化单体

```mermaid
flowchart LR
    student[学生浏览器] --> web["apps/web<br/>页面 / 服务端组合根"]
    web --> agent["packages/agent-core<br/>全模态Asset / 消息Part / 模型 / Gateway Port"]
    web --> canvas["packages/canvas-protocol<br/>公开Artifact与客户端交互协议"]
    web --> runtime["packages/teaching-runtime<br/>判分 / Agent轮次 / 工具执行"]
    web --> gateway["packages/model-gateway<br/>Provider配置 / OpenAI-compatible SSE"]
    gateway --> agent
    runtime --> agent
    runtime --> teaching["packages/teaching-core<br/>状态机 / 掌握度 / 领域事件 / Port"]
    runtime --> db["packages/db<br/>Drizzle适配器 / PostgreSQL"]
    gateway --> runtime
    db --> teaching
```

当前代码已经拆出通用`agent-core`契约、`agent-runtime`上下文物化、Canvas协议、教学核心、教学应用运行时、模型网关与数据库适配器。`agent-core`定义供应商无关的全模态Asset、不可变版本引用、多Part消息、流式事件、运行元数据和Gateway Port；`agent-runtime`在不暴露私有存储地址的前提下物化已验证Asset；`model-gateway`只依赖通用契约。`teaching-core`保持K12纯领域逻辑；`teaching-runtime`包含可信判分、两阶段Turn Orchestrator、状态感知Tool Executor、可信状态推进与事件回放。Next.js组合根已接通匿名身份、Asset上传、EduCanvas SSE、消息/模型/工具/安全账本、取消和刷新恢复；K1的FTS检索、候选白名单、引用持久化/SSE/UI已经进入Turn纵切；Canvas判分后只在可信`ASSESS`状态触发受控状态推进。

当前Web Turn编排仍位于`teaching-runtime`，`teaching-core`也暂时兼容导出通用模型类型。通用Asset已经补齐匿名所有权、持久化、不可变版本、PDF解析和供应商上下文物化的首条纵切；下一步按[ADR-0009](../09-decisions/0009-general-multimodal-platform-and-k12-vertical.md)补对象存储/异步处理与原生视觉Provider，再增量抽取通用Tool/Turn编排，不以一次性重命名或微服务拆分制造高风险重写。

## 目标服务形态

| 服务                | 职责                                 |
| ------------------- | ------------------------------------ |
| `web`               | Next.js页面、SSR、BFF和流式UI        |
| `core-api`          | 用户、Workspace、会话、权限和业务API |
| `realtime-gateway`  | SSE、WebSocket和语音信令             |
| `agent-runtime`     | 通用模型、工具、上下文和运行Trace    |
| `artifact-runtime`  | 通用Artifact提议、生成、校验和版本   |
| `teaching-runtime`  | K12教学状态机、判分和学生状态        |
| `retrieval-service` | 多模态资产检索、重排和证据组装       |
| `ai-worker`         | OCR、切块、Embedding和批处理         |
| `workflow-worker`   | 教材处理、报告和再索引等长任务       |

## 基础设施

- PostgreSQL + pgvector；
- PgBouncer；
- Redis；
- OSS/S3兼容对象存储；
- Temporal；
- Kafka/Redpanda在学习事件量增长后接入；
- OpenTelemetry统一观测。

这些是目标形态的基础设施，不是阶段一启动依赖。Redis、Temporal、Kafka/Redpanda和独立Worker按实际负载与可靠性需求逐步引入。

## 开放问题

- 首次上线采用自建Kubernetes还是托管容器平台；
- 实时语音是否直连模型供应商WebRTC；
- 事件总线在第几个阶段引入；
- 向量服务与业务PostgreSQL是否从第一天物理隔离。
