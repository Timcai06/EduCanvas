# 测试与评测

- 状态：`draft`

## 强制规则

核心纯逻辑必须在**实现它们的同一个PR内**附带单元测试，不允许"先实现后补测"：

- Canvas协议校验（`packages/canvas-protocol`）——安全边界；
- 结构化课程状态机（转移、guard、中断栈）——显式课程模式的正确性边界；
- 掌握度计算与更新——自适应链路的事实基础。

三者都是纯函数逻辑，测试成本低、回报高。UI组件、页面和样式不作此强制。

## 测试层级

- 单元测试：统一Agent Loop、Context/Tool Policy、Profile、状态机、掌握度和Schema；
- 集成测试：PostgreSQL、Gateway持久化、模型Gateway和检索链路；
- 契约测试：前后端API、事件和Canvas Artifact；
- E2E：通用Chat、K12自由问答、结构化课程、Notebook恢复与多模态/Artifact流程；
- 负载测试：对话、检索、事件写入和长连接；
- 故障测试：模型超时、Redis失败、Worker重启和任务重试。

## 当前覆盖状态

测试数量会随分支变化，本文件不维护容易过期的计数；当前数量与通过情况以本地命令和CI运行结果为准。

| 层级                 | 当前状态                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单元测试             | 已覆盖唯一`AgentLoopEngine`多圈工具/预算/单终态、模型流验证、Gateway Service幂等/恢复/审批等待、Client NDJSON、Telegram归一化/切分、Node遍历/escape/重放/撤销，以及Canvas、状态机、掌握度、安全Gate等纯逻辑                  |
| 协议/契约测试        | 已覆盖严格`gateway.v1`角色/Envelope/Event/能力/审批/渠道/Node Schema和依赖边界；Web与TUI Fixture通过Gateway到达同一Notebook/Conversation；另覆盖Canvas信任边界、EduCanvas Web SSE、引用、版本/type/字段/资源上限与reader释放 |
| CI                   | `checks`执行lint、typecheck、unit test与build；`integration`连接PostgreSQL；`e2e`在生产构建上运行Playwright                                                                                                                  |
| PostgreSQL集成测试   | 已覆盖Gateway迁移、User/Agent、私有/共享Notebook、contributor/viewer权限、actor审计、Operation幂等/冲突/跨租户隐藏、审批、Channel binding/Delivery去重、Node配对/心跳/调用/重放结果/撤销，以及原有事务、匿名和Artifact边界   |
| 迁移应用/回滚测试    | 已有迁移应用验证；向下回退与备份恢复演练待完成                                                                                                                                                                               |
| 浏览器E2E            | 生产构建上35个流程覆盖Notebook反复切换及Sources/Studio整体隔离、Artifact/Worker/版本/音频、匿名Cookie、无Provider诚实错误、Gateway兼容SSE、Stop/恢复、引用、移动/桌面Canvas、可访问性、视觉回归与沙箱预览                    |
| 视觉回归             | 已固定桌面/移动Chat-empty、移动AI不可用、`pipeline_flow`桌面/移动/reduced-motion截图；使用reduced-motion和禁用动画稳定像素，并验证关键动画窗口无Layout Shift或长任务                                                         |
| 模型、RAG与Agent评测 | 已有Provider边界、SSE/streaming、消息账本和冻结中英文K12对抗Fixture的工程测试；确定性检测器不替代人工红队，真实课程质量回归集、RAG链路和Agent教学效果评测仍待落地                                                            |

## 本地验证

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
TEST_DATABASE_URL=postgresql://educanvas:educanvas@localhost:5432/educanvas_integration pnpm test:integration
E2E_DATABASE_URL=postgresql://educanvas:educanvas@localhost:5432/educanvas_e2e pnpm test:e2e
```

运行集成测试和E2E前，应先创建对应测试数据库并执行迁移。两类测试都校验数据库名后缀，避免清空开发共享库或生产库；E2E串行运行并使用生产构建。

## AI评测

以下条目是接入真实模型后的评测目标，不代表当前Scripted Gateway或前端Demo Script已经通过这些评测。Demo Script只用于确定性单元测试或显式Fixture，不得作为Agent质量样本，也不进入正常学习页依赖图。

- 课程事实正确性；
- 引用是否支持回答；
- 学段表达是否合适；
- 自由问答是否避免伪造教学进度，结构化课程是否遵循状态；
- 工具选择是否正确；
- Canvas Schema成功率；
- 安全拒答和边界；
- Token、延迟和成本。

## 发布门槛

- 核心流程E2E通过；
- 数据迁移可回滚；
- 无高危安全问题；
- 检索评测不低于当前基线；
- 模型Prompt或版本变更经过回归集；
- 关键监控和告警存在。
