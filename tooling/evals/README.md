# tooling/evals — RAG 评测 harness（Q01）

冻结评测集与可复现离线评测。仓库内唯一入口是 `rag-eval.test.ts`（vitest），
评测全程不调用任何模型、不依赖公网、不读真实密钥。

## 复现命令

前置：本地 PostgreSQL 已建隔离数据库 `educanvas_eval_test`（库名必须以
`_eval`/`_test`/`_integration` 结尾，harness 拒绝清空非隔离库）：

```powershell
$env:TEST_DATABASE_URL = "postgresql://educanvas:educanvas@localhost:5432/educanvas_eval_test"
pnpm --filter @educanvas/db exec vitest run --root ../../tooling/evals --config ../../tooling/evals/vitest.config.ts
```

- vitest 只在 workspace 包中安装，故经 `--filter @educanvas/db exec` 运行；
- `--root ../../tooling/evals` 指向评测目录；`vitest.config.ts` 把
  `@educanvas/*`、`drizzle-orm`、`postgres`、`vitest` 解析到 workspace 源码
  / `packages/db/node_modules`（tooling/ 不是 pnpm workspace 包，Node 解析链
  走不到这些依赖）；
- 每次运行：migrate → truncate（restart identity cascade）→ 重播冻结数据集
  v1 → 生成报告 `reports/rag-eval-v1-<日期>.json`。质量指标部分逐项确定
  （已验证两次运行完全一致）；`latencyMs` 为运行噪声，仅作量级参考。

## 输出

`reports/` 下每个评测集版本一份报告文件：

- `retrievers.*`：三种检索配置（hybrid RRF / FTS-only / 诚实回退）的
  Recall@10/@20、MRR@10、nDCG@10 均值；
- `perQuery.*`：逐查询 golden、候选顺序与指标，以及 hybrid 在
  limit ∈ {5, 10, 20} 下的 Recall（不同 limit 配置比较维度）；
- `latencyMs`：p50/p95；
- `fallbackHonesty`：回退路是否与 FTS-only 等价（诚实标记）；
- `findings`：基线事实（FTS AND 语义、hybrid 无阈值返回）。

## 冻结规则

数据集定义在 `dataset-v1/`，文件头记录了冻结规则与 v1 修订记录。任何语料、
query、golden 或轴定义变更必须新增版本（v2…），不得修改已冻结内容；版本
变更必须产生新报告，不得覆盖旧结论。
