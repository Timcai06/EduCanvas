# 后端工程

- 状态：`draft`

## 当前主选

- 核心API：NestJS + Fastify；
- 数据访问：Kysely或Drizzle配合原生SQL，最终在编码前确定；
- AI计算：Python Worker；
- 长任务：Temporal；
- 缓存和限流：Redis；
- 数据库：PostgreSQL + pgvector；
- 观测：OpenTelemetry。

## 为什么独立于Next.js

- 后端可以单独扩容和发布；
- 避免长任务占用Web进程；
- 独立控制连接池、限流和模型并发；
- 支持未来独立实时网关和AI服务；
- 不依赖单一前端部署平台。

## 高并发策略

- API保持无状态；
- 模型、数据库、检索分别设置并发舱壁；
- 所有外部调用设置超时与熔断；
- 请求使用幂等键；
- 热点内容缓存，但缓存不是事实源；
- 长任务立即入队，不占用请求连接；
- 采用背压和分级降级；
- 记录p50、p95、p99和错误预算。

## Python服务边界

只承担确实需要Python生态的任务，例如OCR、文档解析、Embedding、Rerank和离线评测。用户、课程、权限等核心业务逻辑留在TypeScript后端。

