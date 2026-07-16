# ADR-0001：核心技术栈

- 状态：`superseded`
- 日期：2026-07-13
- 取代者：[ADR-0003](0003-phase1-monorepo-and-drizzle.md) 与 [ADR-0009](0009-general-multimodal-platform-and-k12-vertical.md)——当前架构是 Next.js 模块化单体；NestJS/Fastify 独立后端、Python 服务、Redis 与 Temporal 未被采用。Web 技术栈、GSAP、Headless 组件与 PostgreSQL + pgvector 等仍有效的结论已由后续 ADR 和 canonical 文档承接

## 背景

产品需要支持复杂Web交互、GSAP动画、AI流式响应、长期可维护的业务服务、高并发和可迁移的RAG底座。

## 决定

- Web使用Next.js、React和TypeScript；
- 动画使用GSAP；
- UI使用可修改源码的Headless组件方案；
- 核心后端与Next.js分离，主选NestJS + Fastify；
- Python只承担AI和数据处理任务；
- PostgreSQL + pgvector作为业务和向量底座；
- Redis处理缓存、限流和短期状态；
- Temporal处理长时间可靠工作流。

## 原因

该组合保留TypeScript端到端研发效率，同时隔离长任务与AI计算，能够按服务水平扩容，也不会把系统绑定到单一云或Agent框架。

## 后果

- 需要维护TypeScript和Python两类运行环境；
- 从早期开始定义服务契约和Trace；
- 不能把所有接口随意写进Next.js Route Handler；
- 部署复杂度高于单体Demo，但可以从同一Monorepo逐步拆分。

