# 阶段执行计划

- 状态：`accepted`
- 负责人：项目负责人
- 最后验证时间：2026-07-16

`docs/plan/`是短期执行工作区，用于把阶段目标落实为有负责人、有边界、有证据的任务。这里不是产品、架构、接口或部署事实的长期来源。

## 与现有文档体系的关系

- [`../10-planning/roadmap.md`](../10-planning/roadmap.md)：跨阶段路线图和长期里程碑；
- `active/`：正在执行的阶段计划，同一目标只保留一个主计划；
- `completed/`：完成或取消后经过压缩的收尾记录；
- [`../09-decisions/`](../09-decisions/)：已经接受的重大技术取舍；
- `01-product`至`07-operations`：已实现行为和稳定工程事实的canonical文档。

`plan/`保持无编号，是因为它描述执行状态而不是一个新的主题域；这可以避免与`10-planning`的长期路线图职责冲突。

## 当前计划

当前有两条边界不同、相互依赖的执行线：

1. **平台主线**：[`active/2026-07-platform-decoupling-runtime-hardening.md`](active/2026-07-platform-decoupling-runtime-hardening.md)，负责连续对话、通用Space/Conversation、Agent Runtime、全模态Asset/Source、Artifact Runtime与Platform Shell；
2. **K12垂直线**：[`active/2026-07-real-agent-learning-vertical-slice.md`](active/2026-07-real-agent-learning-vertical-slice.md)，负责教学状态、可信判分、课程纵切和竞赛闭环，不得反向定义平台基础对象。

当前证据状态（2026-07-16）：自动化基线已通过289 unit、46 PostgreSQL integration、23 Chromium E2E、typecheck和production build；真实Provider/SSE、K1检索引用、T1的`ASSESS`推进、有界跨轮Context Snapshot及通用Space/Conversation骨架已接线。架构健康检查同时确认生产Turn向通用Operation迁移、摘要/Artifact上下文、原生多模态、Asset/Source统一、真实Artifact生命周期和生产数据治理仍未完成，因此不得宣称进入staging或production。

最近完成：[`completed/2026-07-pre-research-safe-development.md`](completed/2026-07-pre-research-safe-development.md)。

## 命名规则

- 文件名使用`YYYY-MM-短横线英文主题.md`，例如`2026-07-real-model-vertical-slice.md`；
- 一个文件只描述一个可独立验收的阶段目标；
- 状态只使用`draft`、`active`、`blocked`、`completed`、`cancelled`；
- `active`计划必须有负责人和最后验证时间；
- 依赖另一个计划时使用相对链接，不复制对方的任务清单。

## 生命周期

```text
draft -> active -> completed
                -> cancelled
        blocked -> active
```

计划完成不等于把复选框全部勾上。归档前必须：

1. 记录可复现的测试、截图、PR、部署或人工验收证据；
2. 把已实现的稳定事实回写到对应canonical文档；
3. 重大决策新增或更新ADR；
4. 删除已经失效的候选方案和逐日过程记录；
5. 保留实际交付范围、未完成项、关键偏差、证据和事实文档链接；
6. 将文件移至`completed/`并更新本索引；
7. 清理`active/`中的重复、暂停和被替代计划，必要时基于下一阶段重新组织目录。

单项自动化验证通过只更新 active 计划中的证据状态；只要完成终点仍有未验收能力，计划就继续留在`active/`。

详细协作规则见[`../08-collaboration/documentation-rules.md`](../08-collaboration/documentation-rules.md)。新计划从[`_template.md`](_template.md)开始。
