# 自动 Skill 触发规则

以下场景必须自动调用对应 skill，不需要用户手动输入斜杠命令：

## 写代码前

| 触发条件 | 必须调用 |
|:---|:---|
| 开始任何新功能/新文件的实现 | `superpowers:writing-plans`（先写计划再动手） |
| 实现任何功能或修 bug | `superpowers:test-driven-development`（先写失败测试） |
| 有 2 个以上独立子任务 | `superpowers:dispatching-parallel-agents`（并行分发） |

## 写代码中

| 触发条件 | 必须调用 |
|:---|:---|
| 遇到 bug、测试失败、报错 | `superpowers:systematic-debugging`（结构化排查，不瞎猜） |
| 修改 UI/前端组件的视觉表现 | `frontend-design`（设计方向，避免模板感） |
| 需要做图表/数据可视化 | `dataviz`（颜色/无障碍/一致性规范） |

## 写代码后

| 触发条件 | 必须调用 |
|:---|:---|
| 宣称「完成」「done」「搞定」之前 | `superpowers:verification-before-completion`（跑命令验证，不空口说） |
| 一个任务的代码全部写完 | `review-v2`（安全+质量+性能+架构审查） |
| 涉及安全敏感改动（认证/权限/错误处理） | `security-review`（专项安全审查） |
| 代码超过 200 行改动 | `simplify`（找冗余、找过度工程） |

## 提交流程

| 触发条件 | 必须调用 |
|:---|:---|
| 准备提 PR 或合并分支 | `superpowers:finishing-a-development-branch`（完整收口流程） |
| 收到 review 反馈 | `superpowers:receiving-code-review`（技术验证后再改，不盲目同意） |

## 文档/调研

| 触发条件 | 必须调用 |
|:---|:---|
| 需要写技术文档/用户手册/API 文档 | `ah-technical-writer` |
| 需要多源深度调研（竞品/技术选型） | `deep-research` |

## 执行方式

- 不需要用户输入 `/skill-name`，AI 识别到场景后自动调用 Skill 工具
- 如果一个任务同时触发多个 skill，按「写代码前 → 写代码中 → 写代码后」顺序执行
- 调用时在回复中注明：「自动触发 [skill名]，原因：...」
- 如果用户明确说「不用审查」「跳过验证」，可以跳过，但必须提醒风险
