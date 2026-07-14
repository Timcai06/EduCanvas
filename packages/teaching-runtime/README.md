# @educanvas/teaching-runtime

阶段一教学应用层：编排Canvas服务端判分、`teaching-core`领域规则与事务Port。它不依赖Drizzle或Next.js，Web组合根负责注入数据库适配器并在调用前完成认证和会话归属校验。

当前已实现`GradeCanvasSubmissionService`：把浏览器提交通过私有判分键提升为`assessment_graded`，并在同一事务更新`mastery_states`。HTTP Route Handler尚未开放；未完成身份认证前不能把`sessionId`写接口直接暴露给浏览器。
