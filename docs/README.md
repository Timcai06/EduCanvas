# 开发文档中心

`docs/`是项目的共同事实源，用于记录产品为什么这样做、系统如何实现、当前决定是什么以及如何验证。聊天记录和口头讨论不能替代这里的文档。

## 文档地图

| 目录                    | 记录内容                                            | 主要读者         |
| ----------------------- | --------------------------------------------------- | ---------------- |
| `00-overview`           | 赛题、目标、范围、术语；官方原件归档在`references/` | 所有人           |
| `00-overview/snapshots` | 已注明日期、停止维护的阶段性长报告                  | 历史核对         |
| `01-product`            | 产品形态、用户流程、功能边界                        | 产品、设计、研发 |
| `02-architecture`       | 总体架构、Canvas、GSAP协议                          | 前后端、架构     |
| `03-ai`                 | 智能体、RAG、Embedding、模型路由                    | AI、后端         |
| `04-data`               | PostgreSQL、学习数据、可信事件契约和掌握度事实源    | 后端、数据       |
| `05-engineering`        | 前端、后端和API工程规范                             | 研发             |
| `06-quality`            | 测试、评测、安全和隐私                              | 研发、测试       |
| `07-operations`         | 部署、扩容、监控和故障处理                          | 后端、运维       |
| `08-collaboration`      | 开发和文档协作机制                                  | 所有人           |
| `09-decisions`          | 已确认的架构决策ADR                                 | 所有人           |
| `10-planning`           | 跨阶段路线图、里程碑和长期交付边界                  | 项目负责人       |
| `plan`                  | 当前阶段的短期执行计划、验收证据和收尾记录          | 计划负责人、研发 |
| `templates`             | 新文档模板                                          | 所有人           |

## 已接受的架构方向

- EduCanvas是Chat-first全模态AI平台，K12 AI教师是首个可插拔垂直Agent，不是平台本体；
- 通用Chat、Assets、Agent Runtime、Artifact Runtime和Studio不得依赖教学状态机、掌握度或课程概念；
- Web端采用Next.js、React和TypeScript；
- UI使用可自由修改的Headless组件与自有设计系统；
- 动画统一使用GSAP；
- Canvas使用受控组件协议，不直接执行模型生成的任意代码；
- 核心后端与Next.js解耦；
- PostgreSQL是业务事实数据库，pgvector承载向量检索；
- K12 Agent的教学流程由确定性状态机约束，模型负责表达和受控工具调用；
- 状态机、掌握度、可信领域事件和外部Port集中在`packages/teaching-core`，不依赖Web、数据库或模型供应商；
- 服务端教学用例集中在`packages/teaching-runtime`，由Web组合根注入Drizzle等适配器；
- Canvas交互事件必须经服务端验证后才能提升为影响掌握度的可信领域事件；
- Embedding空间必须记录模型、版本、维度、指令和切块版本。

这些条目说明开发必须遵守的目标边界，不等于所有能力均已落地。

## 当前实现边界

- 已实现：通用`agent-core`模型/流事件/Gateway契约基座、模块化monorepo骨架、两种可判分Canvas Artifact与一个render-only `pipeline_flow`、静态Renderer注册表和AnimationShell、匿名Canvas Server Action、确定性判分、教学状态机、可信学习投影/回放/下一节点推荐、阶段一Drizzle事务适配器、Chat-first学生端布局与深色Halo、EduCanvas SSE对话UI、消息/模型/工具/安全账本、两阶段Tool Loop、取消与刷新恢复、状态感知Tool Executor，以及可配置的原生OpenAI-compatible SSE Provider Adapter；
- 测试替身：Scripted Model Gateway仅用于确定性契约测试，不能导入生产组合根；真实Adapter的CI仍使用官方格式Fixture，不调用外部模型；
- 已接通：通用PDF/图片/Link Asset、不可变版本和消息Part；通用网页实际读取快照、稳定编号、引用子集持久化/SSE/历史恢复/原网址导航；K1 PostgreSQL FTS、Turn快照、候选白名单、引用持久化/SSE/UI；Canvas判分后的受控ASSESS状态推进；
- 已确认的架构缺口：模型输入仍是纯文本；通用Space/Conversation虽已落库但K12账本迁移尚未完成；上传Asset尚未统一进入可检索Chunk；中文`simple` FTS、claim/span引用Anchor、附件重试和对象删除Outbox仍需修复；
- 尚未实现：通用Agent Runtime插件装配、原生图片/音视频Provider输入、受控Artifact提议/确认/独立生成与真实Studio列表、完整教学状态事件接线、正式用户认证、真实Provider live smoke及完整整节课E2E；
- 当前证据只支持本地开发基线；在C1、完整状态事件、受控live smoke和整节课E2E完成前，不宣称已进入shared dev、staging或production；
- `draft`文档中的独立服务和生产基础设施是演进目标，不能作为当前部署事实。

## 文档状态

文档顶部可使用以下状态：

- `draft`：讨论中，不能作为最终实现依据；
- `accepted`：已确认，开发应遵循；
- `superseded`：已被新文档替代；
- `deprecated`：仍保留，但不再使用。

## 更新原则

1. 功能PR修改了行为，就更新对应功能文档；
2. 接口、数据表或事件结构变化，就更新工程或数据文档；
3. 改变重大技术选择，先新增ADR；
4. 文档只写当前事实，历史争论放入ADR；
5. 未确定内容明确写入“开放问题”，不能伪装成结论。

## 路线图与执行计划

`10-planning/roadmap.md`是跨阶段、相对稳定的路线图；`plan/`是短期执行工作区。当前平台主线与K12垂直线分别维护，但共享同一canonical事实源。两者不能互相替代：

- 路线图说明阶段目标、依赖和长期交付边界；
- `plan/active/`只存正在执行且有明确验收条件的阶段计划；
- 完成计划前，必须把实现后的稳定事实回写到对应产品、架构、数据、工程文档或ADR；
- 完成证据写入计划的收尾记录后，再将精简后的计划移入`plan/completed/`；
- 计划中的临时任务拆分、排查过程和候选方案不是长期事实源，过期内容应在归档时删除或压缩。

计划目录的命名、状态和归档流程见[`plan/README.md`](plan/README.md)。

首次参与开发请先阅读[`08-collaboration/team-guide.md`](08-collaboration/team-guide.md)；本地启动优先使用仓库根目录`Makefile`提供的`make setup`、`make dev`和`make check`入口。
