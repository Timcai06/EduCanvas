# 开发文档中心

`docs/`是项目的共同事实源，用于记录产品为什么这样做、系统如何实现、当前决定是什么以及如何验证。聊天记录和口头讨论不能替代这里的文档。

## 文档地图

| 目录                    | 记录内容                                            | 主要读者         |
| ----------------------- | --------------------------------------------------- | ---------------- |
| `00-overview`           | 赛题、目标、范围、术语；官方原件归档在`references/` | 所有人           |
| `00-overview/snapshots` | 已注明日期、停止维护的项目阶段快照                  | 历史核对         |
| `01-product`            | 产品形态、用户流程、功能边界                        | 产品、设计、研发 |
| `02-architecture`       | Gateway、总体架构、Canvas、GSAP协议                 | 前后端、架构     |
| `03-ai`                 | 智能体、RAG、Embedding、模型路由                    | AI、后端         |
| `04-data`               | PostgreSQL、学习数据、可信事件契约和掌握度事实源    | 后端、数据       |
| `05-engineering`        | 前端、后端和API工程规范                             | 研发             |
| `06-quality`            | 测试、评测、安全和隐私                              | 研发、测试       |
| `07-operations`         | 部署、扩容、监控和故障处理                          | 后端、运维       |
| `08-collaboration`      | 开发和文档协作机制                                  | 所有人           |
| `09-decisions`          | 已确认的架构决策ADR                                 | 所有人           |
| `10-planning`           | 跨阶段路线图、里程碑和长期交付边界                  | 项目负责人       |
| `plan`                  | 当前阶段的短期执行计划、验收证据和收尾记录          | 计划负责人、研发 |
| `research`              | 源码研究、能力盘点、实验与待决假设                  | 架构、研发       |
| `templates`             | 新文档模板                                          | 所有人           |

## 已接受的架构方向

- EduCanvas是以教育能力为核心的通用个人Agent平台；Agent是产品主体，Web/TUI/渠道是交互表面；
- EduCanvas Gateway统一承载身份、配对、Notebook路由、能力协商、审批和事件分发；它不同于模型Provider Gateway；
- 通用Chat、Assets、Agent Runtime、Artifact Runtime和Studio不得依赖教学状态机、掌握度或课程概念；
- Web端采用Next.js、React和TypeScript；
- UI使用可自由修改的Headless组件与自有设计系统；
- 动画统一使用GSAP；
- Canvas使用受控组件协议，不直接执行模型生成的任意代码；
- Web只作为第一方客户端和迁移期BFF，长期控制平面与Agent Runtime不依赖Next.js；
- PostgreSQL是业务事实数据库，pgvector承载向量检索；
- 所有普通对话只使用一个通用 `AgentLoopEngine`；K12通过Profile、Skills、Tools和可信领域服务接入；
- 五阶段状态机只约束显式结构化课程，不是普通K12问答的前置条件；
- 状态机、掌握度与可信学习事件集中在`packages/teaching-core`，不依赖Web、数据库或模型供应商；
- `packages/teaching-runtime`只保留K12 Profile、Workflow和领域应用能力，不再拥有独立模型循环；
- Canvas交互事件必须经服务端验证后才能提升为影响掌握度的可信领域事件；
- Embedding空间必须记录模型、版本、维度、指令和切块版本。

这些条目说明开发必须遵守的目标边界，不等于所有能力均已落地。

## 当前实现边界

- 已实现：严格 `gateway.v1`、Gateway HTTP组合根、个人Agent与Notebook Membership、持久Operation/恢复/审批、唯一 `AgentLoopEngine`、Web兼容接入、TUI、Telegram私聊Adapter、可选只读Capability Node；
- 保持可用：真实Provider SSE、账本/取消/刷新恢复、服务端判分、可信学习投影、Notebook聚合、持久Artifact任务、Studio、导图/Slides/闪卡/音频和Canvas共创；
- 测试替身：Scripted Model Gateway仅用于确定性契约测试，不能导入生产组合根；真实Adapter的CI仍使用官方格式Fixture，不调用外部模型；
- 已接通：通用PDF/图片/Link Asset、不可变版本和消息Part；通用网页实际读取快照、稳定编号、引用子集持久化/SSE/历史恢复/原网址导航；K1 PostgreSQL FTS、Turn快照、候选白名单、引用持久化/SSE/UI；Canvas判分后的受控ASSESS状态推进；
- 已确认的剩余缺口：原生图片/音视频模型输入、上传Asset统一摄取、Context摘要、长期学习者记忆、正式IdP、对象删除闭环和production治理；
- Telegram只有官方协议Fixture，没有用户凭据下的live smoke；Node只有L0/L1白名单能力，没有高风险设备控制；
- 当前证据支持本地模块化单体基线；正式认证、外部观测/SLO、受控live smoke、教学质量评测和production hardening完成前，不宣称production就绪；
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
3. 改变重大技术选择，先新增或替换当前ADR；
4. 文档只写当前事实，关键历史压缩进入`09-decisions/decision-history.md`；
5. 未确定内容明确写入“开放问题”，不能伪装成结论。

## 命名与事实分层

- 一个主题目录内需要阅读顺序的文档使用`数字-中文主题.md`，例如`01-系统架构现状.md`；标准、产品名和代码术语可以保留英文，如`02-Gateway与多入口.md`；
- 计划文件使用`YYYY-MM-中文主题.md`，日期表达计划批次，中文主题表达目标；
- `accepted` canonical 文档只记录稳定边界和已验证现状；
- `proposed` 架构文档记录目标、开放问题和决策门，不写成已经实现；
- `research` 记录事实、推断、实验和反例，不替代 ADR；
- `00-overview/snapshots` 只保存停止维护的项目阶段快照，进行中的架构研究放入`research/`。

## 路线图与执行计划

`10-planning/roadmap.md`是跨阶段、相对稳定的路线图；`plan/`是短期执行工作区；`research/`保存研究证据。Gateway-first 与 Web-first 产品入口已经结档；当前 active 计划只研究第二代架构、能力映射和 ADR 决策，不授权生产架构迁移。三类文档不能互相替代：

- 路线图说明阶段目标、依赖和长期交付边界；
- `plan/active/`只存正在执行且有明确验收条件的阶段计划；
- 完成计划前，必须把实现后的稳定事实回写到对应产品、架构、数据、工程文档或ADR；
- 完成证据写入计划的收尾记录后，再将精简后的计划移入`plan/completed/`；
- 计划中的临时任务拆分、排查过程和候选方案不是长期事实源，过期内容应在归档时删除或压缩。

计划目录的命名、状态和归档流程见[`plan/README.md`](plan/README.md)。

首次参与开发请先阅读[`08-collaboration/team-guide.md`](08-collaboration/team-guide.md)；本地启动优先使用仓库根目录`Makefile`提供的`make setup`、`make dev`和`make check`入口。
