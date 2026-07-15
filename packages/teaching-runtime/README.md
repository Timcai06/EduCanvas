# @educanvas/teaching-runtime

## 这个包是什么

EduCanvas的教学应用层：在Canvas协议与`teaching-core`领域规则之间编排用例，并通过Port访问外部能力。它不依赖Drizzle、Next.js或模型供应商；Web组合根负责注入适配器，并在调用前完成认证和会话归属校验。

## 当前实现

- `src/grade-submission.ts`：`GradeCanvasSubmissionService`把不可信Canvas提交经私有判分键验证后提升为`assessment_graded`，并在同一事务更新`mastery_states`；
- `src/tool-executor.ts`：`TeachingToolExecutor`按“权威状态策略 ∩ 已注册能力 ∩ 模型暴露级别”筛选工具，负责整批预检、参数/输出Schema、失败即停、写操作批次隔离、超时结果语义、有界进程内幂等和脱敏审计；
- `src/turn-orchestrator.ts`：`TeachingTurnOrchestrator`把可信会话快照与学生消息编排为状态感知结构化计划，执行受控工具并显式保持教学状态不变；
- `src/testing/scripted-model-gateway.ts`：仅供测试和开发Harness使用的确定性`ModelGateway`替身，不是生产模型适配器；
- `src/index.ts`：包公共出口；
- `src/*.test.ts`：使用内存Fake验证应用服务、模型计划和工具执行契约，不是PostgreSQL集成测试。

当前Agent链路是无持久化的最小应用层纵切：没有真实模型供应商、生产工具Handler、工具结果二次合成或状态转移写入。`apps/web/app/learn/actions.ts`已经开放匿名演示范围内的Canvas bootstrap与提交Server Action；Turn Orchestrator尚未接入浏览器/SSE。正式身份认证完成前，不能把新的会话写能力直接暴露给浏览器。

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
