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

| 层级                 | 当前状态                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 单元测试             | 109个；覆盖Canvas Schema/判分、状态机、工具策略、掌握度、匿名身份、Chat演示脚本、Turn Orchestrator、Tool Executor与应用服务主要分支 |
| 协议/契约测试        | 已覆盖Canvas公开/私有边界与可信学习事件Schema                                                                                       |
| CI                   | 三个job：基础检查（lint/typecheck/109单元测试/build）、PostgreSQL集成测试、生产构建上的浏览器E2E                                    |
| PostgreSQL集成测试   | 8个；覆盖事务写入/回滚、乐观锁、提交并发幂等、归属拒绝、匿名会话服务端过期、原子bootstrap与Artifact冲突                             |
| 迁移应用/回滚测试    | 全新安装和历史数据升级已验证；向下回退与备份恢复演练待完成                                                                          |
| 浏览器E2E            | 4个；覆盖匿名HttpOnly Cookie隔离、Canvas提交和Progress持久化、快速重复提交、篡改Cookie拒绝                                          |
| 模型、RAG与Agent评测 | 已有Scripted Gateway与Agent运行时契约单测；真实适配器、RAG链路和评测集尚未落地                                                      |

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
