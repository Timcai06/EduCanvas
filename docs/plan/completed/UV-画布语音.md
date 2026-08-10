# UV 画布运行时与实时语音收口

- 状态：`completed`
- 完成日期：2026-08-10
- 负责人：项目负责人
- 审核与收口：Codex
- 合并载体：[PR #338](https://github.com/Timcai06/EduCanvas/pull/338)
- 起始基线：`39a0c5fb5a5c81fcbffd54899764ac64e2cdf944`
- 最终全量门禁：[CI run 31381040186](https://github.com/Timcai06/EduCanvas/actions/runs/31381040186)

## 1. 目标与结论

UV 将此前分散的 Canvas、持久 Web Runtime、受控 Experiment Runtime、非 Web
入口投影和实时语音能力收敛为同一组稳定边界。U00-U21 与 V01-V17 已按竞赛级范围
完成；F 画布界面协作线已先行独立归档，最终组合未形成第二套 Runtime、Agent loop、
Canvas 协议或语音事实源。

竞赛级完成不等于生产发布声明。真人麦克风、课堂噪声、十分钟长流、受控实时并发和
实际启用音频留存时的删除回执仍未完成本轮真人实跑。项目负责人于 2026-08-10 明确
将这些项目降为非阻塞后续；fixture 与 CI 证据没有被改称真人证据。

## 2. 实际交付范围

### 2.1 统一 Canvas 工作面

- Source 与 Artifact 通过同一 `CanvasResource`、Renderer manifest 和服务端授权投影
  进入 Web Canvas；原始 Source 不被 Canvas 编辑覆盖。
- PDF、图片、文本、DOCX、音频和视频具备受控预览；结构化和媒体 Artifact 保持版本、
  Provenance、MIME、checksum 与 Notebook 归属。
- Web registry、打开链路、错误状态和兼容旧 `PublicArtifact` 的组合边界完成收口。
- TUI 通过 Gateway 重新授权的资源目录和一次性交接访问；Telegram 只输出有界摘要或
  安全 Web 交接，不执行不支持的 Runtime。

### 2.2 持久 Web Runtime

- 独立 `apps/web-runtime` 承载 Tier 2 持久交互应用，使用不透明 origin、一次性
  bootstrap、版本化消息桥与运行账本。
- iframe 保持 `allow-scripts`、无同源能力、无任意网络、无 Credential；输入、消息、
  输出、时长、并发、队列与消息速率均有硬上限。
- 单一终态、取消竞争、跨主体和跨 Notebook 统一拒绝；非合作 CPU/内存负载进入独立
  runtime-pressure 门禁。

### 2.3 Experiment Runtime

- `ExperimentRuntimePort`、Run 契约、受控 CPU Adapter、输出 Artifact 和有界 Renderer
  已落地；运行不进入 Web 主进程，也不获得任意网络、镜像或依赖执行能力。
- 代码、数据集、镜像、依赖、随机种子、资源预算和输出保留可复现 Provenance。
- U16 只证明 fixture 驱动的可复现实验纵切；生产 Experiment Artifact 数据源尚未接线，
  没有把 fixture 宣称为生产来源。

### 2.4 实时语音与产品接线

- 新增流式转录 Port、严格事件契约、分段 reducer、序列/终态纪律、sherpa-onnx WASM
  Adapter、Gateway 双向通道、短时单次 ticket、配额、背压和稳定失败码。
- 浏览器仅在显式启动后请求麦克风，将输入转换为 16 kHz mono PCM16LE；PCM 不持久化，
  Provider Secret、原始响应和长时 bearer 不进入浏览器。
- 短句模式只在唯一 final 后提交一次既有 Turn；课堂字幕只追加 segment final，零 Turn。
- 首次使用选择 `general` 或 `restricted`。这是竞赛产品偏好，不是监护关系证明；
  `restricted` 可做瞬时云端识别但不留存原始音频。
- 原始音频留存仍必须独立满足同意、最多七天留存、本人或已验证监护人读取、读取审计、
  撤回/到期和 deletion outbox 硬删除，不受模式 Cookie 替代。

## 3. 跨入口一致性

U19 以公共 fixture 和各协议自身的负例证明下列边界：

- Gateway Core/Client、Web、TUI 与 Telegram 对取消、能力不可用、Runtime/内部失败、
  恢复游标、未知事件和终态后事件给出相同事实或明确的安全降级；
- Telegram 不泄漏自由错误文本，只投影有界稳定结果；
- CanvasResource 和 voice ticket 均重新校验主体与 Notebook；
- Web voice BFF 保留 Gateway 统一 404 拒绝语义，不再把授权拒绝抹成 503，也不透传下游
  原始响应体；
- voice idle/duration、输入/输出背压与租约释放继续由流式通道配额测试证明。

## 4. 关键决策与偏差

### 4.1 语音模型质量

V01 选择 sherpa-onnx WASM SIMD，否决在 Node 20/22/24 下输出为空的原生 addon。
V02-T/U/V/W 的失败与受限模型证据全部保留：部分候选虽然请求稳定，但专业术语召回未达
目标。项目负责人于 2026-08-05 接受该竞赛阶段风险，采用“本地草稿 + 可选云端复核”
双路径；这不是对识别质量的生产级背书。

### 4.2 体验模式不等于合规证明

为竞赛演示减少启动摩擦，产品采用首次 `general/restricted` 二选一。模式 Cookie 只控制
体验和瞬时处理路径，不是监护关系、法定同意或 delegated grant。任何原始音频留存仍由
`audio_consents`、`audio_retentions`、读取审计和删除 Outbox 的独立事实约束。

### 4.3 U20 竞赛级验收

U20 的自动化安全、协议、隔离、配额和失败语义证据通过。以下真人证据没有在本轮产生，
由项目负责人明确列为非阻塞后续：

- 真实浏览器麦克风与可重复课堂噪声；
- 十分钟连续流、断线、重连与取消；
- 受控实时并发和配额拒绝；
- 实际启用留存时的撤回/到期、对象删除和 Outbox 回执；
- 真实课堂声学条件下的术语质量与资源曲线。

精确边界见[UV 真实环境验收记录](../../06-quality/10-UV真实环境验收.md)。这些项目不阻挡
竞赛阶段归档，但在生产发布或真实课堂可用声明前仍必须补齐。

## 5. 安全与数据不变量

- 单一 Agent loop 仍由 `packages/agent-runtime` 持有；Canvas、Experiment 和 Voice 不创建
  第二个 loop，也不能直接写判分、掌握度或课程状态。
- Provider SDK 类型、Secret、Prompt、原始响应和堆栈止于 `packages/model-gateway`。
- Web Runtime 和 Experiment Runtime 均不继承主页面 Credential、任意网络或可信学习
  事实写入口；未知类型、版本和能力 fail closed。
- Ticket 绑定主体和 Notebook、短时且单次使用；跨主体/跨 Notebook 不通过错误差异泄漏
  资源存在性。
- 语音日志不记录 PCM、原始 Provider body 或学生内容；持久音频与转录文本保持独立生命
  周期，删除音频不伪造文本删除。

## 6. 验收证据

### 6.1 原子任务结论

| 范围        | 结论 | 核心证据                                                        |
| ----------- | ---- | --------------------------------------------------------------- |
| U00-U08     | PASS | Canvas 基线、统一 registry、媒体生成/版本/恢复和安全读取        |
| U09-U12     | PASS | Web Runtime 契约、策略、独立进程、真实组合与压力负例            |
| U13-U16     | PASS | Experiment Port、CPU Adapter、Renderer 与可复现 fixture 纵切    |
| U17-U19     | PASS | TUI/Telegram 投影、跨入口 conformance 与授权偏差修复            |
| U20         | PASS | 竞赛级自动化边界；真人长流矩阵明确降为非阻塞后续                |
| U21         | PASS | 全量门禁、canonical 回写、计划压缩与归档                        |
| V01-V17     | PASS | 路线选择、流式协议/Adapter/Gateway、数据生命周期与 Web 产品接线 |
| V02-T/U/V/W | 保留 | 模型或 Provider 质量未达目标的负面证据，不因工程完成而改写      |

### 6.2 U21 全量门禁

[CI run 31381040186](https://github.com/Timcai06/EduCanvas/actions/runs/31381040186)

最终门禁必须来自一次 `workflow_dispatch` 且 `release_evidence=true` 的 CI；它覆盖 quality、
DB/Worker/Migration integration、Windows、runtime pressure、完整浏览器矩阵、desktop、
release evidence、secret scan 和最终 `checks` 聚合。普通 docs-only PR 检查不冒充此证据。

## 7. Canonical 回写

- 产品与流程：[产品定义](../../01-product/01-产品定义.md)、
  [用户流程](../../01-product/03-用户流程.md)
- 架构：[系统架构现状](../../02-architecture/01-系统架构现状.md)、
  [Gateway 与多入口](../../02-architecture/02-网关与多入口.md)、
  [统一 Canvas 工作面](../../02-architecture/04-统一画布工作面.md)
- 数据与工程：[数据设计](../../04-data/02-数据设计.md)、
  [后端工程](../../05-engineering/02-后端工程.md)、
  [前端工程](../../05-engineering/03-前端工程.md)
- 质量与运维：[测试与评估](../../06-quality/03-测试与评估.md)、
  [安全与隐私](../../06-quality/02-安全与隐私.md)、
  [部署与可观测性](../../07-operations/01-部署与可观测性.md)
- 决策：[ADR-0009](../../09-decisions/0009-统一画布工作面与运行时分层.md)、
  [ADR-0018](../../09-decisions/0018-实时语音输入选型与流式识别边界.md)、
  [ADR-0019](<../../09-decisions/0019-持久Web Runtime隔离与安全边界.md>)、
  [ADR-0022](../../09-decisions/0022-音频留存监护人单独同意边界.md)

## 8. 未完成项去向

| 未完成项                                | 是否阻塞归档 | 去向                                          |
| --------------------------------------- | ------------ | --------------------------------------------- |
| 真人麦克风、噪声、10 分钟长流、受控并发 | 否           | 项目负责人归档后功能检查；发布声明前补证      |
| 实际留存撤回/到期与删除回执             | 否           | 仅在启用留存时执行；与 O 线删除队列联合验证   |
| 生产 Experiment Artifact 数据源         | 否           | 后续产品纵切，不得用 U16 fixture 冒充         |
| 真实 Provider 的课堂术语质量            | 否           | 后续模型评测与 Provider 选择                  |
| 完整生产 IdP、外部 SLO 与 live 渠道凭据 | 否           | G 产品发布闭环及独立生产化任务                |
| 对象删除崩溃恢复与定时任务              | 否           | [O 删除队列](../active/O-删除队列.md) O03/O04 |
| 产品知识与三层 Memory                   | 否           | [KM 知识记忆](../active/KM-知识记忆.md)       |

本计划不再返回 `active/`。上述后续如进入实现，应领取对应 active 计划或新建单一职责任务，
不得重新打开已经冻结的 Canvas、Runtime、Gateway 或音频生命周期事实。
