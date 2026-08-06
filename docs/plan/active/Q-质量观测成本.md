# 检索质量、运行观测、成本预算与测试真实性

- 任务分配名：`Q 质量观测成本`
- 状态：`active`
- 负责人：项目负责人
- 实现执行：协作 Agent，每次只领取一个原子任务
- 代码审核与最终验收：Codex
- 最后验证时间：2026-08-06
- 当前领取任务：`Q00`
- 并行计划：[R 运行时收敛](R-运行时事实收敛.md)、[W 工作面画布](W-工作面画布收敛.md)
- 后续出口：[G 产品发布闭环](G-产品发布闭环.md)
- 关联计划：[KM 知识记忆](KM-知识记忆.md)

## 一、目标

本线把“有大量测试、Trace 和 fail-safe”升级为“能够回答系统是否真的有效、是否在降级、
每轮成本多少、何时不应发布”。

阶段结束后必须验证：

1. RAG 不只证明越权安全和确定性，还能用冻结数据证明相关性与回答质量；
2. Embedding、Vector、Provider、Tool、Artifact、Telemetry 等降级有稳定内部原因和指标，
   不再全部吞成空结果或 NOOP；
3. Agent Turn 使用 token、模型调用、工具、时间和货币成本的统一预算，而不只靠字符数和
   固定工具轮数；
4. 关键用户流程有 SLI/SLO、结构化日志、Trace 和告警条件；
5. 测试数字不会掩盖只测 Chromium Desktop、UI lane 被排除、retry 后才通过或无 coverage
   门槛等事实；
6. 供应链、bundle、迁移和生产依赖有可审核门禁；
7. 本线不接真实学生数据，不在 CI 调用收费模型，不把一次本机实验写成稳定结论。

## 二、已经确认的代码事实

| 事实 | 代码位置 | 本计划处理 |
| --- | --- | --- |
| 混合检索使用冻结 Source、FTS、pgvector、RRF 和版本化候选 | `packages/db/src/knowledge-hybrid-retrieval.ts` | 保留安全设计，补质量评测 |
| Embedding 和向量失败会静默退回 FTS | `apps/web/server/teaching/knowledge-retrieval-runtime.ts` 等 | 增加稳定内部降级原因 |
| Telemetry 支持 OTLP Trace 和 health，但失败可退回 NOOP | `packages/telemetry/src/**` | 增加指标、健康与 SLO |
| Agent Loop 预算主要是字符、工具数量和固定轮数 | `packages/agent-runtime/src/agent-loop.ts`、`turn-engine.ts` | 建立 token/cost budget |
| 默认 E2E 只有 Desktop Chromium，排除 `@ui`，CI retry=1 | `playwright.config.ts` | 测试真实性报告与门禁 |
| CI 有 secret scan、unit、integration、runtime pressure、E2E | `.github/workflows/ci.yml` | 保留并补缺口 |
| Actions 使用主版本 tag，未完整 SHA pin | `.github/workflows/**` | 供应链加固 |

## 三、绝对文件边界

### 允许修改或新增

- `tooling/evals/**`
- `tooling/quality/**`
- `packages/telemetry/src/**`
- `packages/agent-core/src/**` 中 usage/budget/health 契约
- `packages/agent-runtime/src/**` 中 budget/trace 接线
- RAG retrieval runtime 和对应测试
- `.github/workflows/**`
- `playwright.config.ts`、Vitest coverage 配置
- 性能、迁移、供应链和运维 canonical 文档
- 本计划文件

### 默认禁止

- 不改变检索权限边界或绕过候选白名单；
- 不在 CI 调用真实收费模型、外部搜索或用户凭据；
- 不实现 Memory、产品知识或新的教学功能；
- 不用高基数原文、Prompt、学生内容、对象 key 或 Secret 作为 metric label；
- 不用 metrics 取代业务事实表；
- 不为了追求覆盖率写无意义 snapshot 或 mock 私有实现；
- 不修改其它 active 计划文件。

## 四、共同提示词

```text
你只执行“Q 检索质量、运行观测、成本预算与测试真实性”当前指定的一个原子任务。

先阅读 AGENTS.md、CLAUDE.md、本计划、测试策略、Telemetry、RAG、Model Gateway 和
Operations 文档。每条 shell 命令必须以 rtk 开头。

硬边界：
- 所有评测数据必须是合成、公开或明确授权并脱敏的冻结夹具；
- CI 不调用收费模型，不依赖公网和真实密钥；
- 指标 label 禁止包含用户 ID、Prompt、正文、URL query、对象路径、Secret 或高基数原始错误；
- 用户可见响应保持诚实降级，内部必须记录稳定 reason；
- token/cost 预算不能信任客户端或模型自报；
- 不用测试数量、coverage 百分比或绿色 CI 单独证明产品质量；
- 不替 Codex 宣布 PASS，不提交、推送或合并。

实施规则：
1. 先定义指标、分母、冻结数据和失败阈值；
2. 再写 harness/adapter；
3. 最后接 CI 或 dashboard；
4. 所有结论必须可复现并包含样本量和置信限制。

完成回报必须包含：
- 指标定义、数据版本、样本量、基线和阈值；
- 代码/测试/报告路径；
- 实际命令、退出码和结果摘要；
- 隐私、高基数、成本和供应链检查；
- 未覆盖范围与不能推出的结论；
- rtk git diff --check/name-status/status。
```

## 五、执行顺序与并行关系

```text
Q00
 ├→ Q01 → Q02 ─┐
 ├→ Q03 ───────┼→ Q06 → Q07
 ├→ Q04 ───────┤
 └→ Q05 ───────┘
```

- Q01 检索评测、Q03 成本预算、Q04 观测、Q05 测试真实性可并行；
- Q02 依赖 Q01 的冻结指标；
- Q06 只在前述门禁稳定后修改 release/CI 汇总。

## 六、原子任务

### Q00：质量指标、数据边界与失败阈值冻结

- 依赖：无
- 文件边界：本计划、只读源码
- 可并行：否

定义并冻结：

- Retrieval：Recall@k、MRR、nDCG、citation precision、无答案拒答；
- Answer：evidence coverage、unsupported claim rate、引用可打开率；
- Runtime：成功率、取消成功率、outcome_unknown、fallback rate；
- Latency：TTFT、Turn total、tool duration、retrieval duration；
- Cost：input/output token、model calls、embedding units、tool/runtime cost；
- UI/Test：retry count、flaky count、browser/device matrix、bundle budget；
- Privacy：禁止采集字段和保留期。

完成标准：

- 每个指标有分子、分母、采集点、版本和发布阈值；
- 明确哪些是 CI gate、趋势指标和人工评审；
- 不把 Trace span 数量写成用户价值指标。

### Q00 指标契约 v1（2026-08-06 冻结）

> 契约说明：
>
> - 分类：`G`=CI gate（发布阻塞）、`T`=趋势指标（只观测、暂不阻塞）、`M`=人工评审（Codex/负责人抽查）；
> - 现状：`HAS`=现有数据面可直接采集（给出代码位置）、`BUILD`=采集点尚未存在，由标注任务建设；
> - 阈值策略：Q00 只冻结定义、分母、采集点和版本；**数值基线由各任务用真实数据实测后回填**（Q01 冻结评测集、Q05 覆盖率基线、Q03 成本基线），不预先伪造数值。回填时按"基线 × 保留系数"或"发布门槛 = 基线，只防回归"两种方式之一记录；
> - 指标 label 一律低基数，禁止用户 ID、Prompt、正文、URL query、对象路径、Secret 或高基数原始错误（计划第四节硬边界）；
> - 不设"Trace span 数量"类指标（span 数不是用户价值）。

#### Retrieval（冻结评测集上的离线指标，Q01 建立）

| 指标 | 分子/分母 | 采集点 | 版本 | 阈值 | 分类 |
| --- | --- | --- | --- | --- | --- |
| Recall@10 / Recall@20 | 每 query 命中相关 chunk 数 / 该 query 相关 chunk 总数，按 query 平均 | `tooling/evals/**`（BUILD，Q01） | eval-dataset-v1 | Q01 实测基线回填 | G |
| MRR@10 | 首个相关候选的 1/rank，按 query 平均 | 同上 | eval-dataset-v1 | 基线回填 | G |
| nDCG@10 | DCG/IDCG（相关分按证据与 query 匹配度 0/1） | 同上 | eval-dataset-v1 | 基线回填 | G |
| citation precision | 回答中引用落在相关候选内的引用数 / 回答全部引用数 | 同上（离线判分） | eval-dataset-v1 | 基线回填 | G |
| 无答案拒答率 | 无答案 query 正确拒答数 / 无答案 query 总数 | 同上 | eval-dataset-v1 | 基线回填 | G |
| 检索延迟 p50/p95 | 检索耗时分位数（含 vector + fuse） | 同上（harness 计时）；线上 `BUILD`（Q02） | eval-dataset-v1 | 基线回填 | T |
| 检索 fallback 率 | vectorApplied=false 的检索数 / 检索总数 | `retrieveHybrid` 返回结构已含 `vectorApplied`（`packages/db/src/knowledge-hybrid-retrieval.ts:61-70`，HAS）；落指标 `BUILD`（Q02） | contract-v1 | 基线回填 | T |

#### Answer

| 指标 | 分子/分母 | 采集点 | 版本 | 阈值 | 分类 |
| --- | --- | --- | --- | --- | --- |
| evidence coverage | 回答主张中可被检索证据支持的主张数 / 主张总数 | 离线判分（Q01 harness 扩展） | eval-dataset-v1 | 基线回填 | M |
| unsupported claim rate | 无证据支持的主张数 / 主张总数 | 同上 | eval-dataset-v1 | 基线回填 | G |
| 引用可打开率 | 引用投影为 available 的引用数 / 回答引用总数 | 投影 `available/superseded/tombstoned`（`packages/db/src/knowledge-retrieval-repository.ts:796-802`，HAS） | contract-v1 | 基线回填 | T |

#### Runtime

| 指标 | 分子/分母 | 采集点 | 版本 | 阈值 | 分类 |
| --- | --- | --- | --- | --- | --- |
| Turn success rate | completed 的 turn 数 / 终态 turn 总数（completed+failed+cancelled） | lifecycle settle 三态（`packages/agent-runtime/src/turn-application/ports.ts:59`，HAS）；落指标 `BUILD`（Q04） | contract-v1 | 基线回填 | G |
| 取消成功率 | cancelled（经 cancellation 端口二次确认）turn 数 / (cancelled+failed) turn 数 | `turn-application/session.ts:82-91`（HAS） | contract-v1 | 基线回填 | T |
| outcome_unknown 率 | 工具调用 outcome_unknown 数 / 工具调用总数 | `AgentToolCallStatus`（`packages/agent-core/src/tool-call-ledger.ts:9,15`，HAS） | contract-v1 | 基线回填 | T |
| 检索异常率 | 检索抛错或 fused 空结果次数 / 检索总数 | fused 空：`knowledge-hybrid-retrieval.ts:352-362`（HAS）；异常计数 `BUILD`（Q02） | contract-v1 | 基线回填 | T |
| 失败码分布 | 各 `TurnApplicationFailureCode` 计数 | 12 个失败码（`packages/agent-core/src/turn-application-contracts.ts:98-111`，HAS） | contract-v1 | 无固定阈值，异常跳变人工评审 | T/M |

#### Latency

| 指标 | 分子/分母 | 采集点 | 版本 | 阈值 | 分类 |
| --- | --- | --- | --- | --- | --- |
| TTFT | 模型首 token 耗时 | 指标名已定义 `model_first_token_latency_ms`（`packages/teaching-runtime/src/observability.ts:34-46`，定义 HAS，调用点 `BUILD`（Q04）） | contract-v1 | 基线回填 | T |
| Turn total | 整个 turn 耗时 | `teaching_turn_latency_ms` 同名处理 | contract-v1 | 基线回填 | T |
| Tool duration | 单次工具调用耗时 | 现状无采集（`BUILD`，Q04） | contract-v1 | 基线回填 | T |
| Retrieval duration | 单次检索耗时 | 现状无采集（`BUILD`，Q02） | contract-v1 | 基线回填 | T |

#### Cost

| 指标 | 分子/分母 | 采集点 | 版本 | 阈值 | 分类 |
| --- | --- | --- | --- | --- | --- |
| input/output token（含 cacheHit/reasoning） | 每 turn 累加值 | `ModelUsage` 已落账（`packages/agent-core/src/model-run-ledger.ts:56-59`，HAS） | contract-v1 | Q03 预算模板回填 | G |
| model calls / turn | ledger 记录模型调用次数 | 同 HAS；预算检查在 `turn-engine.ts`（现状为字符/轮数硬上限） | contract-v1 | Q03 预算模板回填 | G |
| embedding units | embedding 调用次数与 token | usage 现状不外发（`openai-compatible-embedding-model-gateway.ts:153-154`，`BUILD`，Q03） | contract-v1 | 基线回填 | T |
| 估算货币成本 | 服务端按 token × 单价估算（`estimated` 标记） | 现状无估算路径（`BUILD`，Q03；provider 自报不可信，必须服务端保守估算） | contract-v1 | Q03 预算模板回填 | G |

#### UI / Test 真实性

| 指标 | 分子/分母 | 采集点 | 版本 | 阈值 | 分类 |
| --- | --- | --- | --- | --- | --- |
| retry count | 各 e2e 用例 retry 次数 | `playwright.config.ts:37`（retries=CI?1:0）已存在，报告汇总 `BUILD`（Q05） | contract-v1 | 无限 retry 禁止（Q05） | G |
| flaky count | 重试后通过的用例数 | `failOnFlakyTests` 已启用（`playwright.config.ts:35`，HAS） | contract-v1 | 发布门槛内不允许 flaky | G |
| browser/device matrix | 覆盖的浏览器/视口集合 | 现状仅 Desktop Chromium（`playwright.config.ts:55-60`）；第二浏览器或移动 viewport `BUILD`（Q05） | contract-v1 | Q05 建成后 ≥2 环境 | G |
| coverage 率 | 核心包语句/分支覆盖率（排除生成代码与纯类型） | 现状无 coverage 配置（`BUILD`，Q05；先真实基线后设阈值） | contract-v1 | Q05 基线回填 | G |
| bundle/route size | 产物与路由体积 | 现状无检查（`BUILD`，Q05） | contract-v1 | Q05 基线回填 | G |

#### Privacy（禁止采集字段与保留期）

- 禁止采集：用户 ID、Prompt 正文、回答正文、URL query、对象路径、Secret、Provider body、Embedding 向量、高基数原始错误文本（计划第四节 + `turn-trace-adapter.ts` 白名单语义已有先例）；
- 允许采集：低基数标识（operationId/traceId、稳定 reason/code、模型与版本、turn 终态）、聚合数字（token 计数、耗时、计数）；
- 保留期：指标时序数据与评测报告的保留策略由 Q04 运维文档规定；RAG 评测集版本变更必须产生新报告，**不得覆盖旧结论**（计划第九节）。

#### 契约版本与回填记录

- 本契约版本：`v1`（2026-08-06 冻结）；
- 各数值阈值回填时在此小节登记 `（任务号，日期，基线数据，阈值数值）`；
- 任何指标定义变更必须 bump 契约版本并记录变更原因，禁止静默修改。

**Q01 回填登记（2026-08-06，数据集 eval-dataset-v1，报告 `tooling/evals/reports/rag-eval-v1-2026-08-06.json`，二次运行指标完全一致）：**

- Recall@10 / Recall@20（hybrid）：**1.0 / 1.0**；MRR@10：**0.844**；nDCG@10：**0.891**。阈值（G）：发布门槛 = 基线，只防回归（Recall@10 ≥ 0.9、MRR@10 ≥ 0.75）；
- Recall@10 / Recall@20（纯 FTS）：**0.75 / 0.75**；MRR@10：**0.813**；nDCG@10：**0.732**。基线事实：FTS 为全词 AND 语义（`websearch_to_tsquery simple`），部分重叠/同义词必然零命中，词法侧天花板由查询词表决定（见报告 findings.ftsAndSemantics）；阈值（T，趋势）不设硬门槛，记录回归对比；
- fallback（向量不可用）：指标与纯 FTS 完全一致（等价性断言成立），retriever 如实标记 `postgres_fts` + `rrf-fallback-v1`；
- 检索延迟（hybrid，本地评测库）：**p50 ≈ 6.9ms，p95 ≈ 15.6ms**（n=150）。阈值（T）：趋势指标，Q02 线上采集后再定线上阈值；
- 检索 fallback 率：评测中为 0（三配置均为显式指定，不产生意外降级）；线上阈值 Q02 采集后回填；
- 无答案拒答率（词法路）：**1.0**（q4/q8 在 FTS 与 fallback 下均空候选）；hybrid 路按 ADR-0015 设计无阈值返回平局候选（拒答语义由上层 agent 层承担）——此为基线事实而非缺陷；
- citation precision / evidence coverage / unsupported claim rate / 引用可打开率：Q01 未扩展回答判分（答案层需真实模型），**留待 Q02 之后**评估，此处不登记数值；
- 基线发现（记录而非缺陷）：① hybrid 向量路无绝对相似度阈值（ADR-0015 文档化行为）；② 陈旧向量排除生效（q10 零词面查询下 c1 不出现在向量路）；③ 注入 chunk 存在不影响正常查询排序（q7 答案仍居首）。

### Q01：RAG 冻结评测集与可复现 Harness

- 依赖：Q00
- 文件边界：`tooling/evals/**`、RAG 测试夹具和只读 Adapter
- 可并行：是

评测集至少包含：

- 教材原文可直接回答；
- 跨 chunk 问题；
- 同义改写；
- 无答案；
- 冲突来源；
- 过期版本；
- Prompt injection；
- 跨 Notebook/用户越权；
- 词法强、向量弱；
- 向量强、词法弱。

比较：

- FTS；
- Hybrid RRF；
- Vector unavailable fallback；
- 不同 chunk/limit 配置。

完成标准：

- 数据、query、expected evidence、版本和授权来源冻结；
- Harness 可离线运行；
- 报告同时给出质量、延迟和 fallback；
- 不根据单次结果手工挑案例；
- 质量阈值未达到时不能宣称“RAG 已完成”。

### Q02：检索与能力降级可观测性

- 依赖：Q01
- 文件边界：Embedding/RAG runtime、Telemetry adapter、稳定错误类型及测试
- 可并行：否

建立低基数内部 reason：

- `not_configured`
- `invalid_configuration`
- `provider_timeout`
- `provider_unavailable`
- `invalid_dimensions`
- `corpus_not_embedded`
- `vector_query_timeout`
- `extension_unavailable`
- `fallback_fts`

要求：

- 用户仍可获得 FTS 结果；
- Trace/metric/health 能区分原因；
- 不记录 Provider body、query 正文或 embedding；
- Vector applied rate 和 fallback rate 可计算。

完成标准：

- 每种 reason 有测试；
- dashboard/报告可识别长期隐性降级；
- failure reason 不成为高基数 label；
- 不改变候选权限和引用白名单。

### Q03：Agent Turn token、时间与成本预算

- 依赖：Q00
- 文件边界：Agent usage/budget contracts、Model Gateway metadata、Turn Application 接线和测试
- 可并行：是

预算维度：

- 最大输入 token；
- 预留输出 token；
- 最大模型调用数；
- 最大工具调用数；
- 最大工具结果 token；
- 最大 wall-clock；
- 最大估算货币成本；
- Profile/任务类型预算模板。

要求：

- 字符上限可作为安全兜底，但不再是主要成本语义；
- Provider usage 缺失时使用保守估算并明确 `estimated`；
- 预算由服务端决定；
- 超预算返回稳定、不可伪装为成功的终态；
- 预算事件进入账本/Trace，但不暴露价格密钥或用户正文。

完成标准：

- General、Teaching、Artifact 生成有不同预算模板；
- 工具结果压缩或截断有明确协议；
- 重试计入调用和时间预算；
- 有边界、取消和估算误差测试。

### Q04：Metrics、SLI/SLO、结构化日志与 Runbook

- 依赖：Q00
- 文件边界：Telemetry、service health、operations docs、测试
- 可并行：是

最低 SLI：

- Turn success/failed/cancelled；
- TTFT 与总延迟；
- Model/provider errors；
- Tool latency/failure/outcome_unknown；
- Retrieval fallback/vector applied；
- Worker backlog/retry/dead letter；
- Artifact generation failure；
- Telemetry exporter health。

要求：

- Metrics 不替代 Turn/Operation/Learning 业务事实；
- 所有日志使用稳定 code、requestId/traceId；
- 不记录敏感正文；
- 为每个 release-blocking SLO 写触发条件、检查命令和 Runbook；
- Collector 未配置时 health 明确 degraded/disabled。

完成标准：

- 本地或测试环境可以生成并断言指标；
- SLO 文档包含窗口、目标、错误预算和发布影响；
- 至少完成一次故障注入演练；
- 告警不会因单次用户错误触发全局事件。

### Q05：测试真实性、覆盖率与多环境门禁

- 依赖：Q00
- 文件边界：CI、Vitest/Playwright 配置、测试报告工具
- 可并行：是

目标：

- 汇总 unit/integration/E2E 数量之外的覆盖维度；
- 对核心包设置合理 coverage threshold，排除生成代码和纯类型；
- CI 报告 flaky/retry，retry 后通过不得完全隐藏；
- 至少一个第二浏览器或移动 viewport 进入稳定 lane；
- `@ui` 测试有独立必跑或发布前门禁；
- 增加 bundle/route size 和 hydration warning 检查；
- 不让视觉抖动阻塞所有后端 PR，可使用路径触发和 nightly/release lane。

完成标准：

- CI Summary 明确显示未覆盖平台；
- coverage threshold 先基于当前基线设定，再逐步提高；
- 失败测试不能靠无限 retry；
- 关键流程有数据库隔离和非生产库门禁。

### Q06：供应链、迁移与发布证据加固

- 依赖：Q02、Q03、Q04、Q05
- 文件边界：`.github/workflows/**`、依赖/迁移检查工具、运维文档
- 可并行：否

目标：

- GitHub Actions pin 到审计过的 commit SHA；
- 启用 dependency review、license policy、SBOM 或等价清单；
- Container/model/Runtime 依赖使用 digest/manifest；
- 数据库迁移记录锁表、回滚、N-1、fresh install 和预计风险；
- release evidence 汇总测试、retry、coverage、bundle、migration、SLO、供应链结果；
- 不把 optional/manual job 的 skip 写成通过。

完成标准：

- 恶意或高风险依赖变更可被门禁阻止；
- 每个 migration 有语义说明；
- 发布报告可追溯到 commit 和 CI artifact；
- Secret scan allowlist 有最小范围和解释。

### Q07：基线报告与收口

- 依赖：Q06
- 文件边界：本计划、canonical quality/operations 文档
- 可并行：否

完成标准：

- 生成一份可复现的质量基线报告；
- 报告清楚区分已验证、未验证和当前降级；
- RAG、成本、SLO、测试矩阵和供应链均有稳定入口；
- 失败阈值已接入发布门，不只存在于文档；
- Codex 独立复核后归档。

## 七、验证台账

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| Q00 指标冻结 | `PENDING` | metric contract v1（2026-08-06 写入本计划，待验收） |
| Q01 RAG eval | `PENDING` | frozen dataset v1 + harness 可复现（reports/rag-eval-v1-2026-08-06.json，含 hybrid limit 5/10/20 扫描；两次运行质量指标逐项一致；待验收） |
| Q02 降级观测 | `PENDING` | reason matrix + telemetry tests |
| Q03 Turn budget | `PENDING` | budget tests + ledger evidence |
| Q04 SLO/Runbook | `DONE` | metrics registry（15 个闭集指标，8 项 SLI 全覆盖）+ 组合根包装（web/gateway/worker）+ internal metrics 端点 + SLO/Runbook（Q04 PR，CI 全绿） |
| Q05 测试真实性 | `PENDING` | CI summary + browser/coverage/bundle |
| Q06 供应链发布 | `PENDING` | dependency/migration/release gates |
| Q07 收口 | `PENDING` | reproducible baseline report |

## 八、阶段级验证

```text
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test:unit
rtk pnpm test:integration
rtk pnpm test:e2e
rtk pnpm build
rtk pnpm exec node tooling/evals/run.mjs
rtk git diff --check
rtk git diff --name-status origin/main...HEAD
rtk git status --short
```

具体评测命令由 Q01 固定，不得在 Q00 预先伪造。

## 九、风险与回退

- 先旁路采集指标，再设发布门，避免一次性阻塞全部开发；
- 预算先 report-only，再对高风险路径 enforce；
- Coverage 阈值以真实基线为起点，不能通过排除核心文件制造提升；
- 指标高基数或敏感字段泄漏立即回退并删除数据；
- RAG 评测集版本变化必须产生新报告，不能覆盖旧结论。

## 十、收尾检查表

- [ ] RAG 有冻结质量评测；
- [ ] 所有关键降级有稳定内部原因和指标；
- [ ] Turn 使用 token/time/cost 预算；
- [ ] SLI/SLO、结构化日志和 Runbook 已接通；
- [ ] CI 显示 retry、coverage、浏览器和 bundle 真相；
- [ ] 供应链与迁移有发布门；
- [ ] 质量基线报告可复现；
- [ ] 计划已归档并更新 active 索引。
