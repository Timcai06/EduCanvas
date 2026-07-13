# @educanvas/canvas-protocol

## 这个包是什么

这是EduCanvas前后端共享的受控Canvas协议包，负责定义模型可以输出哪些Artifact、每种Artifact允许哪些参数，以及Canvas交互如何形成学习事件。它是安全边界而不是普通类型集合：未通过这里的Zod Schema校验的数据不能进入渲染层，模型生成的任意HTML、JavaScript或GSAP源码也不能绕过协议执行。

## 核心文件导读

- `src/index.ts`：包的公共出口；其他workspace只应从这里导入稳定API。
- `src/artifact.ts`：Artifact版本、白名单联合Schema和统一校验结果。
- `src/artifacts/classification-game.ts`：分类游戏类别、题目与跨字段一致性约束。
- `src/artifacts/quiz.ts`：单选测验、选项以及正确答案引用约束。
- `src/events.ts`：Canvas关键交互可产生的学习事件信封。
- `tsconfig.json`：协议包的TypeScript检查范围。

## 常用命令

以下命令都从仓库根目录执行：

```bash
pnpm --filter @educanvas/canvas-protocol typecheck  # 检查协议类型和Zod定义
pnpm dev                                             # 启动消费本包的Web应用进行联调
pnpm build                                           # 由Web生产构建验证源码包可被正确转译
pnpm lint                                            # 运行仓库现有lint任务
```

本包当前没有独立`dev`、`lint`或`build`脚本；`pnpm lint`目前不会单独扫描本包源码，不能把它描述为本包级Lint通过。为保持本次纯文档/注释改动，README只记录现状，不修改脚本配置。

## 改动前必读的doc/文档

- [Canvas与GSAP](../../doc/02-architecture/canvas-and-gsap.md)：Artifact类型、动画控制和事件要求。
- [智能体编排](../../doc/03-ai/agent-orchestration.md)：模型通过哪些受控工具生成Canvas。
- [数据设计](../../doc/04-data/data-design.md)：学习事件和Artifact如何持久化。
- [安全与隐私](../../doc/06-quality/security-and-privacy.md)：为什么协议必须使用白名单和沙箱。
- [ADR-0002](../../doc/09-decisions/0002-controlled-canvas.md)：受控Canvas的正式架构决定。
