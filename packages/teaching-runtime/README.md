# @educanvas/teaching-runtime

## 这个包是什么

EduCanvas的教学应用层：在Canvas协议与`teaching-core`领域规则之间编排用例，并通过Port访问外部能力。它不依赖Drizzle、Next.js或模型供应商；Web组合根负责注入适配器，并在调用前完成认证和会话归属校验。

## 当前实现

- `src/grade-submission.ts`：`GradeCanvasSubmissionService`把不可信Canvas提交经私有判分键验证后提升为`assessment_graded`，并在同一事务更新`mastery_states`；
- `src/index.ts`：包公共出口；
- `src/grade-submission.test.ts`：使用内存Fake验证应用服务分支与事务契约，不是PostgreSQL集成测试。

当前只有上述判分用例。Turn Orchestrator、状态转移、提示、误区生命周期、下一节点推荐、模型工具循环和事件回放仍待实现。HTTP Route Handler/Server Action尚未开放；未完成身份认证前不能把接收`sessionId`的写接口直接暴露给浏览器。

## 常用命令

从仓库根目录执行：

```bash
pnpm --filter @educanvas/teaching-runtime test
pnpm --filter @educanvas/teaching-runtime typecheck
pnpm test
```

## 改动边界

- 领域公式、状态机和事件Schema留在`@educanvas/teaching-core`；
- Artifact输入与判分协议留在`@educanvas/canvas-protocol`；
- Drizzle实现留在`@educanvas/db`；
- 认证、HTTP和依赖注入留在`apps/web`服务端边界。
