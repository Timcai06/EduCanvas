# @educanvas/canvas-protocol

## 这个包是什么

这是EduCanvas前后端共享的受控Canvas协议包，负责定义模型可以输出哪些Artifact、每种Artifact允许哪些参数，以及Canvas交互如何形成学习事件。它是安全边界而不是普通类型集合：未通过这里的Zod Schema校验的数据不能进入渲染层，模型生成的任意HTML、JavaScript或GSAP源码也不能绕过协议执行。

## 核心文件导读

- `src/index.ts`：浏览器安全公共出口，只含公开Artifact与不可信交互事件。
- `src/server.ts`：服务端专用出口，包含完整答案、私有判分键和确定性判分函数。
- `src/artifact.ts`：Artifact版本、白名单联合Schema和统一校验结果。
- `src/public-artifact.ts`：结构上排除答案与解析的浏览器投影。
- `src/grading.ts`：公开投影/私有判分键拆分和服务端确定性判分。
- `src/artifacts/classification-game.ts`：分类游戏类别、题目与跨字段一致性约束。
- `src/artifacts/quiz.ts`：单选测验、选项以及正确答案引用约束。
- `src/artifacts/pipeline-flow.ts`：固定槽位、步骤顺序、暂停点和文案上限等 render-only 教学动画语义。
- `src/events.ts`：不可信Canvas交互事件的逐类型strict Schema；服务端可信领域事件不属于本包。
- `tsconfig.json`：协议包的TypeScript检查范围。

## 当前实现边界

- 协议版本当前只有 `1`；白名单联合已注册 `classification_game`、`quiz` 和 `pipeline_flow`；
- `classification_game` 与 `quiz` 可拆分公开投影/私有判分键，并由服务端确定性判分；
- `pipeline_flow` 只渲染教学流程动画，不生成判分键，也不接受模型提供选择器、时长、任意动画属性或 GSAP 代码；
- `apps/web` 已为三种协议注册静态 React Renderer，但当前课程 Artifact 来自服务端预置数据；Agent 提议、学生确认、独立生成和 Studio 持久化列表仍未实现；
- 本包只定义和校验协议，不负责数据库存储、Renderer 生命周期、模型调用或教学状态推进。

## 常用命令

以下命令都从仓库根目录执行：

```bash
pnpm --filter @educanvas/canvas-protocol typecheck  # 检查协议类型和Zod定义
pnpm --filter @educanvas/canvas-protocol test       # 运行Artifact与交互事件契约测试
pnpm dev                                             # 启动消费本包的Web应用进行联调
pnpm build                                           # 由Web生产构建验证源码包可被正确转译
pnpm lint                                            # 运行仓库现有lint任务
```

本包当前没有独立`dev`、`lint`或`build`脚本；`pnpm lint`目前不会单独扫描本包源码，协议边界主要由TypeScript、Zod与Vitest覆盖。

## 改动前必读的 docs/ 文档

- [Canvas与GSAP](../../docs/02-architecture/canvas-and-gsap.md)：Artifact类型、动画控制和事件要求。
- [智能体编排](../../docs/03-ai/agent-orchestration.md)：模型通过哪些受控工具生成Canvas。
- [数据设计](../../docs/04-data/data-design.md)：学习事件和Artifact如何持久化。
- [安全与隐私](../../docs/06-quality/security-and-privacy.md)：为什么协议必须使用白名单和沙箱。
- [ADR-0002](../../docs/09-decisions/0002-controlled-canvas.md)：受控Canvas的正式架构决定。
