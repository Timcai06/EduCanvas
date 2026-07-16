# 当前执行计划

当前有两份执行中的计划：

- [`2026-07-platform-decoupling-runtime-hardening.md`](2026-07-platform-decoupling-runtime-hardening.md)：平台主线，优先解除 K12 Session/Teaching Turn 对通用 Chat、Space、Agent Runtime 与 Artifact 的结构性绑定；
- [`2026-07-real-agent-learning-vertical-slice.md`](2026-07-real-agent-learning-vertical-slice.md)：K12 垂直线，继续完成可信教学事件、受控产物和竞赛整节课闭环。

截至 2026-07-16，自动化基线已通过289项单元测试、46项PostgreSQL integration、23项Chromium E2E、TypeScript typecheck与production build。K1检索引用、T1的`ASSESS`状态推进、有界跨轮Context Snapshot和通用Space/Conversation骨架已接入，但生产Turn通用化、摘要/Artifact上下文、原生多模态、真实Artifact生命周期、controlled live Provider smoke与整节课证据仍不完整；自动化基线通过不等于shared dev或平台化验收完成。

完成或取消时按[`../README.md`](../README.md)的生命周期回写事实并归档。
