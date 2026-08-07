# 检索质量、运行观测、成本预算与测试真实性

- 任务分配名：`Q 质量观测成本`
- 状态：`active`
- 负责人：项目负责人
- 实现执行：协作 Agent，每次只领取一个原子任务
- 代码审核与最终验收：Codex
- 最后验证时间：2026-08-07
- 当前领取任务：`Q07`（收口，复核后归档）
- 并行计划：[R 运行时收敛](../completed/R-运行时事实收敛.md)、[W 工作面画布](W-工作面画布收敛.md)
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

| 事实                                                        | 代码位置                                                     | 本计划处理               |
| ----------------------------------------------------------- | ------------------------------------------------------------ | ------------------------ |
| 混合检索使用冻结 Source、FTS、pgvector、RRF 和版本化候选    | `packages/db/src/knowledge-hybrid-retrieval.ts`              | 保留安全设计，补质量评测 |
| Embedding 和向量失败会静默退回 FTS                          | `apps/web/server/teaching/knowledge-retrieval-runtime.ts` 等 | 增加稳定内部降级原因     |
| Telemetry 支持 OTLP Trace 和 health，但失败可退回 NOOP      | `packages/telemetry/src/**`                                  | 增加指标、健康与 SLO     |
| Agent Loop 预算主要是字符、工具数量和固定轮数               | `packages/agent-runtime/src/agent-loop.ts`、`turn-engine.ts` | 建立 token/cost budget   |
| 默认 E2E 只有 Desktop Chromium，排除 `@ui`，CI retry=1      | `playwright.config.ts`                                       | 测试真实性报告与门禁     |
| CI 有 secret scan、unit、integration、runtime pressure、E2E | `.github/workflows/ci.yml`                                   | 保留并补缺口             |
| Actions 使用主版本 tag，未完整 SHA pin                      | `.github/workflows/**`                                       | 供应链加固               |

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

**Q05 回填登记（2026-08-06，覆盖率为三个核心包 vitest v8 实测，bundle 为本地 Next 16 构建实测）：**

- 语句/分支/函数/行覆盖率基线（排除生成代码与纯类型，`packages/{telemetry,agent-core,agent-runtime}/vitest.config.ts`）：telemetry **92.14 / 90.37 / 83.11 / 92.55**、agent-core **96.21 / 94.34 / 96.70 / 97.43**、agent-runtime **78.43 / 74.70 / 86.57 / 80.51**。阈值（G，防回归，只升不降）：telemetry 92/90/83/92、agent-core 96/94/96/97、agent-runtime 78/74/86/80；
- bundle/route size 基线（`tooling/quality/bundle-size-baseline.json`，2026-08-06）：JS 总量 **4120016B**、最大 chunk **875476B**、静态路由 HTML 5 个（login/register/settings/not-found/global-error）。门禁：任一超基线 1.1× 或新增路由 HTML >300KB → fail；
- retry 纪律：CI 上 `failOnFlakyTests` 使 flaky 直接失败（retries=1），retry/flaky 名单经 `tooling/quality/playwright-summary.mjs` 写入 CI Summary，禁止无限 retry、禁止隐藏 retry 后通过；

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

> 判定口径（2026-08-07 Code Owner 审核后统一）：**DONE** = 已合入 main 且 main 回归全绿；
> **IMPLEMENTED** = 产物完成且分支 CI 全绿，待合并，或已合入但 main 回归待恢复；
> **PENDING** = 已回退（Q01）或已合入未验收（Q02）。main 回归状态与根因见
> `docs/06-quality/09-质量基线报告.md` §1 现状注记与 §7 降级 3/5。

| 任务            | 状态      | 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q00 指标冻结    | `DONE`    | 指标组与阈值语义冻结于本计划 Q00 节（Retrieval/Answer/Runtime/Latency/Cost/UI-Test/Privacy 与 CI gate/趋势/人工评审分类）；文档任务无独立 PR；汇总见 docs/06-quality/09-质量基线报告.md（2026-08-07 回写）                                                                                                                                                                                                                                                                                                                                                                                               |
| Q01 RAG eval    | `PENDING` | #288 合入后被 #293 revert（延迟基线混入多检索器配置，与 hybrid-only 描述不符）；tooling/evals 已从 git 移除，评测入口不可用；修正版已重提（#307，分支 CI 全绿，报告 rag-eval-v1-2026-08-07.json）待 Code Owner 审批合并                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Q02 降级观测    | `PENDING` | #289 已合入 main（a7df105）；9 reason 冻结于 agent-core（含网关错误映射）+ retrieveHybrid 输入/异常/语料三侧分类（corpus_not_embedded 用 500ms 预算探针区分身份不匹配）+ teaching-runtime `retrieval_degradations` 指标（9 reason 均测）；集成测试覆盖 not_configured/invalid_configuration/invalid_dimensions/corpus_not_embedded/vector_query_timeout，单测覆盖 extension_unavailable/fallback_fts 与网关映射；降级不断供 FTS；**合入时 e2e gate FAILURE**（runtime-composition `dbModule.getDb is not a function`，基分支过期；main 已于 2026-08-07 回归全绿）；待验收：对 Q02 变更集单独复跑 CI 确认 |
| Q03 Turn budget | `DONE`    | budget controller + ledger（#291，已合入 main 01424d4）；注：合入于 2026-08-06 Actions 故障期，head 最终 check 含 e2e failure，main 现已回归全绿（2026-08-07）                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Q04 SLO/Runbook | `DONE`    | metrics registry + Web/Gateway/Worker 唯一组合层包装 + internal metrics 端点 + SLO/Runbook（#295，已合入 main 0085e06；合入期 head 最终 check 含 failure/skipped，Actions 故障期影响，main 现已回归全绿）；指标故障旁路业务结果，协议型标签值使用闭集                                                                                                                                                                                                                                                                                                                                                    |
| Q05 测试真实性  | `IMPLEMENTED` | coverage 门禁（telemetry 92/90/83/92、agent-core 96/94/96/97、agent-runtime 78/74/86/80，2026-08-06 基线）+ chromium-mobile 第二环境进默认 lane + hydration 检查 + bundle/route size 基线（jsTotal 4120016B/entry 875476B）+ @ui 独立 lane（chromium+firefox，nightly+路径触发）+ retry/flaky 汇总进 CI Summary；#303 已合入 main `88027be`（分支 CI 3 次全绿）；main 回归待恢复（size gate 基线过时：#304 已重录基线随 `d01db29` 合入，#309 另录精确基线待合并，见报告 §7-3）                                                                                                                                                                                                                  |
| Q06 供应链发布  | `IMPLEMENTED` | #304：action 40 位 SHA pin + dependency-review 门禁（high 即 fail）+ 容器 digest pin + migration records 门禁（51 迁移全字段）+ release evidence 语义（passed/skipped/failed 终态语义）+ 供应链文档 08-供应链与发布证据.md；#304 已合入 main `d01db29`，分支最终 run（#31161098720）**8 项终态全绿**（dependency-review/secret-scan/checks/integration/windows/runtime-pressure/e2e SUCCESS + release-evidence SKIPPED 预期，rc1 未发布）；main 回归待恢复（dependency-review push-event 缺陷，修复 PR #311，见报告 §7-5）                                                                                                                                                                                                                                                                                            |
| Q07 收口        | `IMPLEMENTED` | docs/06-quality/09-质量基线报告.md（2026-08-07-2，按 Code Owner 审核意见修订：job 清单/数量/基线/状态语义/门禁接线修正）+ 本文台账回写；**待 Code Owner 复审合并**；Codex 独立复核后归档                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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

- [ ] RAG 有冻结质量评测 —— **未满足**：Q01 已回退（#293），修正版待重提；
- [x] 所有关键降级有稳定内部原因和指标 —— Q02 已合入 main（9 reason + 指标 + 测试），台账「待验收」项待 Codex 复核时确认；
- [x] Turn 使用 token/time/cost 预算 —— Q03 已合入 main；
- [x] SLI/SLO、结构化日志和 Runbook 已接通 —— Q04 已合入 main；
- [ ] CI 显示 retry、coverage、浏览器和 bundle 真相 —— Q05 分支全绿，**#303 待合并**，合入后勾选；
- [ ] 供应链与迁移有发布门 —— Q06 分支全绿，**#304 待合并**，合入后勾选；
- [x] 质量基线报告可复现 —— docs/06-quality/09-质量基线报告.md（2026-08-07-1）；
- [ ] 计划已归档并更新 active 索引 —— Codex 独立复核通过后执行（归档至 completed/ 并按 README 更新 active 索引）。
