# U16 可复现实验 Smoke

状态：`PASS`（2026-08-04，Codex 复核）

本证据只验证 Experiment Runtime 的一个最小、可复现 CPU 纵切，不代表教学产品功能已经接线。
生产 `artifact.experiment` 数据源仍不存在，因此 U15 Renderer 继续不注册到生产 registry。

## 固定输入与执行环境

| 项目          | 固定值                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------ |
| 环境          | `cpu-python-3.11`                                                                          |
| 镜像          | `python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93` |
| Docker Server | `29.6.1`                                                                                   |
| Python 依赖   | `python@3.11.15`，无第三方数据科学包                                                       |
| randomSeed    | `20260804`                                                                                 |
| 代码          | `packages/experiment-runtime/fixtures/u16/experiment.py`                                   |
| 代码 SHA-256  | `eb87850610b574671180ea8c5a44e81879970234f11e130fd1c23f0ea0fd8340`                         |
| 输入          | `packages/experiment-runtime/fixtures/u16/input.csv`                                       |
| 输入 SHA-256  | `6f3db621a1805e9c2664dd1b55f394a02e5234968b40f1391b62848e2475c175`                         |

资源预算固定为：10 秒、256 MiB、32 个进程、16 KiB stdout、16 KiB stderr、64 KiB
输出、最多 4 个输出文件。容器使用 U14 已审核的 `--network none`、只读根文件系统、降权
用户、capability 全移除与 `no-new-privileges`。

## 两次运行结果

`reproducible-experiment.smoke.test.ts` 在两个独立临时目录和容器中顺序执行
`u16-repro-1`、`u16-repro-2`。两次提交给 OutputCommitter 的文件逐字节一致：

| 输出              | MIME               | byteSize | SHA-256                                                            |
| ----------------- | ------------------ | -------: | ------------------------------------------------------------------ |
| `metrics.json`    | `application/json` |      133 | `9ed2c322bb7a3a34a850b1a6fb7f075f58ff35282f7e48785f601a4796c98253` |
| `predictions.csv` | `text/csv`         |       94 | `5e89973528eb108e1aa00b627207ddcf50fc29dfeadd515f88240d5335f72037` |

结果为斜率 `2.0`、截距 `1.0`、RMSE `0.0`；训练索引由固定随机种子生成。实验在容器内
主动探测网络和 GPU，结果分别为 `network_blocked=true`、`gpu_visible=false`。

## 失败、取消与清理

- 无限循环在 300 ms 预算下稳定收敛为 `experiment_timeout`；
- 无限 stdout 超过 4096 bytes 后稳定收敛为 `resource_quota_exceeded`；
- 运行中用户取消稳定收敛为 `cancelled`；
- 测试后 `docker ps -a --filter name=^exp-u16-` 无遗留容器。

真实取消测试发现并修复了 U14 遗留竞态：之前同一 `AbortSignal` 同时交给 Node `spawn` 和
Runtime 终态仲裁，`AbortError` 可能抢先把用户取消映射为 `execution_failed`。现在仅
`runDockerContainer` 拥有 timeout/cancel 终态裁决，并通过 `docker rm -f` 清理容器。

## 验证命令

```bash
rtk pnpm --dir packages/experiment-runtime test
rtk pnpm --dir packages/experiment-runtime exec vitest run src/reproducible-experiment.smoke.test.ts
rtk pnpm --dir packages/experiment-runtime typecheck
rtk docker ps -a --filter name=^exp-u16- --format '{{.Names}}'
```

实测结果：完整 Experiment Runtime `12 files / 96 tests` 全部通过；U16 目标 smoke 独立重跑
`2/2` 通过；typecheck 通过；无遗留容器。测试证据不含宿主绝对路径、对象存储键、Prompt、
Secret 或堆栈。
