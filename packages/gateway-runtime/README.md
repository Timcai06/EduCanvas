# `@educanvas/gateway-runtime`

EduCanvas 云端 Gateway 的应用服务和 Port。它负责可信路由、幂等 Operation、事件持久化/恢复和 Runtime 调用，不包含 HTTP、Next.js、Drizzle、Provider 或教育领域实现。

生产适配器由 `apps/gateway` 和 `packages/db` 组合；测试提供严格的内存适配器。
