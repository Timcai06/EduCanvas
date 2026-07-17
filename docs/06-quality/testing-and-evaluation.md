# 测试与评测

- 状态：`draft`

## 强制规则

核心纯逻辑必须在**实现它们的同一个PR内**附带单元测试，不允许"先实现后补测"：

- Canvas协议校验（`packages/canvas-protocol`）——安全边界；
- 教学状态机（转移、guard、中断栈）——教学正确性边界；
- 掌握度计算与更新——自适应链路的事实基础。

三者都是纯函数逻辑，测试成本低、回报高。UI组件、页面和样式不作此强制。

## 测试层级

- 单元测试：状态机、掌握度、Schema和工具；
- 集成测试：PostgreSQL、Redis、模型Gateway和检索链路；
- 契约测试：前后端API、事件和Canvas Artifact；
- E2E：学生完成一节课的完整流程；
- 负载测试：对话、检索、事件写入和长连接；
- 故障测试：模型超时、Redis失败、Worker重启和任务重试。

## 当前覆盖状态

测试数量会随分支变化，本文件不维护容易过期的计数；当前数量与通过情况以本地命令和CI运行结果为准。

| 层级                 | 当前状态                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 单元测试             | 已覆盖Canvas Schema/判分、`pipeline_flow`播放控制模型、设计QA默认关闭、状态机、工具策略、掌握度、匿名身份、浏览器Turn状态机、Learning Rail能力模型、Chat演示脚本、Turn Orchestrator、Tool Executor、K12输入安全决策与流式输出Gate等纯逻辑                                      |
| 协议/契约测试        | 已覆盖Canvas公开/私有边界、`pipeline_flow`注册槽位/顺序/暂停点及任意selector/duration/GSAP拒绝、render-only不生成判分键、普通动画事件不产生assessment成功、可信学习事件Schema、EduCanvas SSE跨chunk解析、版本/type/字段/资源上限与reader释放                              |
| CI                   | `checks`执行lint、typecheck、unit test与build；`integration`连接PostgreSQL；`e2e`在生产构建上运行Playwright                                                                                                                                                                          |
| PostgreSQL集成测试   | 已覆盖事务写入/回滚、乐观锁、提交并发幂等、归属拒绝、匿名会话服务端过期、原子bootstrap与Artifact冲突等数据库边界                                                                                                                                                                     |
| 迁移应用/回滚测试    | 已有迁移应用验证；向下回退与备份恢复演练待完成                                                                                                                                                                                                                                       |
| 浏览器E2E            | 已覆盖匿名HttpOnly Cookie隔离、无Provider诚实错误、真实SSE delta/有限生命周期播报、Stop取消与新ID重试、S0 truth、禁用菜单项、Composer换行、桌面分隔条ARIA、移动Canvas dialog/inert/焦点循环、Canvas/抽屉焦点恢复、320px/200%缩放、判分与Progress持久化、快速重复提交及篡改Cookie拒绝；`pipeline_flow`另覆盖桌面键盘/暂停点/速度、完成文案时序、含空格Artifact ID的ARIA命名、移动无横向溢出及reduced-motion同步跳转/`will-change:auto` |
| 视觉回归             | 已固定桌面/移动Chat-empty、移动AI不可用、`pipeline_flow`桌面/移动/reduced-motion截图；使用reduced-motion和禁用动画稳定像素，并验证关键动画窗口无Layout Shift或长任务                                                                                                                      |
| 模型、RAG与Agent评测 | 已有Provider边界、SSE/streaming、消息账本和冻结中英文K12对抗Fixture的工程测试；确定性检测器不替代人工红队，真实课程质量回归集、RAG链路和Agent教学效果评测仍待落地                                                                                                                    |

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
- 是否遵循教学状态；
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
