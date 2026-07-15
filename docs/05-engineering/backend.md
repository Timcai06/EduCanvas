# 后端工程

- 状态：`draft`

## 当前主选

- 阶段一Web/BFF：Next.js Server Component与Server Action；
- 阶段二核心API候选：NestJS + Fastify；
- 数据访问：Drizzle配合原生SQL（ADR-0003已确定）；
- AI计算：Python Worker；
- 长任务：Temporal；
- 缓存和限流：Redis；
- 数据库：PostgreSQL + pgvector；
- 观测：OpenTelemetry。

除阶段一Next.js BFF、Drizzle和PostgreSQL外，Python Worker、Temporal、Redis、pgvector检索适配器和OpenTelemetry仍是目标能力，尚未实现。

## 阶段一已实现边界

- 匿名身份使用32-byte随机base64url bearer，仅保存在HttpOnly、SameSite=Lax Cookie中；数据库只保存`anon:v1:<sha256>`派生标识；
- 课程bootstrap在一个PostgreSQL事务内创建或复用Session，并保存公开Artifact与私有判分键；并发请求通过事务级advisory lock收敛到同一会话；
- Server Action不接受客户端session或student字段，而是从Cookie和固定课程范围恢复归属；
- `GradeCanvasSubmissionService`在事务内再次校验可信学生对session的归属，再判分、追加可信事件并更新掌握度投影；
- 页面读取只返回公共Artifact和Progress DTO，私有判分键不进入浏览器。

该身份机制只服务阶段一匿名演示，不提供注册、登录、账号恢复、角色权限或跨设备身份，因此不能替代正式认证。

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
