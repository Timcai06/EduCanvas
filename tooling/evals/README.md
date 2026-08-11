# tooling/evals — deterministic Agent product evaluation

冻结评测集与可复现离线评测。`rag-eval.test.ts` 验证真实检索实现；
`agent/agent-eval.test.ts` 通过现有 `AgentLoopEngine`、`ToolKernel` 与 K12
安全策略验证 Tool/Artifact 和 Teaching Safety。全程不调用真实模型、不依赖
公网、不读取 Provider Secret。

## 复现命令

前置：本地 PostgreSQL 已建隔离数据库 `educanvas_eval_test`（库名必须以
`_eval`/`_test`/`_integration` 结尾，harness 拒绝清空非隔离库）：

```powershell
$env:TEST_DATABASE_URL = "postgresql://educanvas:educanvas@localhost:5432/educanvas_eval_test"
pnpm test:eval
```

- vitest 只在 workspace 包中安装，故经 `--filter @educanvas/db exec` 运行；
- `--root ../../tooling/evals` 指向评测目录；`vitest.config.ts` 把
  `@educanvas/*`、`drizzle-orm`、`postgres`、`vitest` 解析到 workspace 源码
  / `packages/db/node_modules`（tooling/ 不是 pnpm workspace 包，Node 解析链
  走不到这些依赖）；
- 每次运行：migrate → truncate（restart identity cascade）→ 重播冻结数据集
  v1 → 生成报告 `reports/rag-eval-v1.json`。质量指标部分逐项确定
  （已验证两次运行完全一致）；延迟按检索器配置拆分（2026-08-07 修正：
  v1-08-06 报告曾把三种配置混入单一分位，重提后 `latencyMsByRetriever`
  逐配置给出，hybrid-only 基线取 hybrid 分位），仍为运行噪声，仅作量级参考。

## 输出

`reports/` 下每个评测集版本一份报告文件：

- `retrievers.*`：三种检索配置（hybrid RRF / FTS-only / 诚实回退）的
  Recall@10/@20、MRR@10、nDCG@10 均值；
- `perQuery.*`：逐查询 golden、候选顺序与指标，以及 hybrid 在
  limit ∈ {5, 10, 20} 下的 Recall（不同 limit 配置比较维度）；
- `latencyMsByRetriever.*`：各检索配置各自的 p50/p95 与样本数；
- `fallbackHonesty`：回退路是否与 FTS-only 等价（诚实标记）；
- `findings`：基线事实（FTS AND 语义、hybrid 无阈值返回）。
- `agent-eval-agent-v1.json`：只包含 fixture ID、稳定结果码和聚合数字；
  不包含输入正文、Prompt、Provider body、Secret 或真实学生内容。
- `eval-gate-v1.json`：将报告与 `baselines/*.json` 独立比较。Critical safety、
  authorization、terminal exactly-once 均要求 100%，非关键评分单独报告。

## 冻结规则

数据集定义在 `dataset-v1/` 与 `agent/v1/`，门槛位于 `baselines/`。任何语料、
query、golden、Agent case 或评分轴变更必须新增版本（v2…），不得覆盖历史
baseline。报告明确限定为合成集回归证据，不宣称真实课程语义质量。

## Protected Provider Canary

`provider-canary/` 是与上述离线 eval 分离的真实供应商探针。它只由
`.github/workflows/provider-canary.yml` 的 `workflow_dispatch` 启动，并绑定需要
人工批准的 `provider-canary` GitHub Environment；普通 PR、main push 与 nightly
均不会读取 DashScope Secret 或产生模型费用。

- `scenarios-v1.json` 最多 5 个冻结场景，每场景固定 2 次 Provider operation
  （CosyVoice TTS → 内存重采样 → Paraformer ASR）；当前 v1 为 2 个场景、4 次调用。
- PCM 只在 runner 内存中存在，不写文件、不上传；summary 只保存场景 ID、成功率、
  p50/p95、相似度和稳定错误码，不保存输入正文、识别文本、Provider body 或 Secret。
- workflow 10 分钟超时；初期只作为趋势证据，不进入普通 PR required checks。
- GitHub Environment 未配置 Secret 时只会让人工 canary 失败，不影响文字聊天、
  Dictation、Live fake-provider E2E 或常规 CI。
