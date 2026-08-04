# Voice Lab

V01/V02 的本地、手工复现实验台。它比较 `sherpa-onnx-node` 原生 addon
与 `sherpa-onnx`（Node 中运行的 WASM SIMD），不纳入 CI，也不接入业务包。
模型、WAV、生成的 fixture、`node_modules` 和 `results` 都被忽略，不能提交。

## 固定实验条件

- 模型：`sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20`
- fixture：模型自带 `test_wavs/0.wav` 至 `3.wav`，均要求 16 kHz 单声道
- 输入：100 ms PCM chunk，随后 1.5 s 零值尾静音，再调用 `inputFinished()`
- 包：`sherpa-onnx-node` 与 `sherpa-onnx` 1.13.4（Git `14280725`）

模型目录默认是相对的 `models/`；也可用 `VOICE_LAB_MODEL_DIR` 指向本地模型。
runner 拒绝绝对的 fixture/热词路径，避免把个人机器路径写入证据。

```bash
npm ci --prefix tooling/voice-lab
npm run test:compare --prefix tooling/voice-lab
# 以指定 Node 运行同一矩阵（仓库 engine >= 22）
/path/to/node22/bin/node tooling/voice-lab/run-compare.mjs --engine both
/path/to/node24/bin/node tooling/voice-lab/run-compare.mjs --engine both
```

每个 run 输出 JSON：逐 fixture 的文本、是否非空、初始化时间、解码时间、RTF、
包/Node/平台版本及错误。`--output results/name.json` 可把同一 JSON 保存到被忽略目录。
非空文本以外的结果会以退出码 1 失败；配置/路径错误是退出码 2。

## 已实际运行的矩阵（2026-07-29，Apple Silicon arm64）

| Node              | 原生 addon | WASM SIMD | 原生 RTF      | WASM RTF      | 结论       |
| ----------------- | ---------- | --------- | ------------- | ------------- | ---------- |
| 20.20.2（仅兼容） | 0/4 非空   | 4/4 非空  | 0.0300–0.0357 | 0.1166–0.1323 | 原生空文本 |
| 22.23.1           | 0/4 非空   | 4/4 非空  | 0.0316–0.0366 | 0.1180–0.1317 | 原生空文本 |
| 24.18.0           | 0/4 非空   | 4/4 非空  | 0.0301–0.0352 | 0.1160–0.1295 | 原生空文本 |

三组矩阵均使用上面的同一 WAV、采样率、分块与尾静音。WASM 的初始化约
1.48–1.87 s，原生约 0.48–0.52 s；原生较快不是可用性的替代品。
完整逐 fixture 的被忽略 JSON 可用 runner 在本地重新生成。

## V02-R：热词对照实验

### 控制变量

Before 和 After 共用完全相同的配置，唯一差异是热词文件：

| 参数                | 值                                                           |
| ------------------- | ------------------------------------------------------------ |
| engine              | `wasm`                                                       |
| model               | `sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20` |
| modelingUnit        | `cjkchar+bpe`                                                |
| bpeVocab            | 模型目录下的 `bpe.vocab`                                     |
| decodingMethod      | `modified_beam_search`                                       |
| maxActivePaths      | `4`                                                          |
| chunkMs             | `100`                                                        |
| tailSeconds         | `1.5`                                                        |
| fixture             | 16 kHz mono PCM WAV                                          |
| Before hotwordsFile | （空）                                                       |
| After hotwordsFile  | `fixtures/hotwords-bagging-boosting.txt`                     |
| hotwordsScore       | 1.5 / 2.0 / 3.5（预声明）                                    |

### 预声明实验矩阵（V02-R02）

**以下矩阵在任何实验运行前写入本文件。所有组合必须全部报告，不得只保留有利结果。**

| #   | Fixture                     | TTS Voice | Rate | Score | 类型           |
| --- | --------------------------- | --------- | ---- | ----- | -------------- |
| 1   | `bagging-boosting.wav`      | Tingting  | 80   | 1.5   | before / after |
| 2   | `bagging-boosting.wav`      | Tingting  | 80   | 2.0   | before / after |
| 3   | `bagging-boosting.wav`      | Tingting  | 80   | 3.5   | before / after |
| 4   | `bagging-boosting-fast.wav` | Tingting  | 120  | 1.5   | before / after |
| 5   | `bagging-boosting-fast.wav` | Tingting  | 120  | 2.0   | before / after |
| 6   | `bagging-boosting-fast.wav` | Tingting  | 120  | 3.5   | before / after |
| 7   | `bagging-boosting-slow.wav` | Tingting  | 50   | 1.5   | before / after |
| 8   | `bagging-boosting-slow.wav` | Tingting  | 50   | 2.0   | before / after |
| 9   | `bagging-boosting-slow.wav` | Tingting  | 50   | 3.5   | before / after |
| 10  | `bagging-boosting-en.wav`   | Samantha  | 80   | 1.5   | before / after |
| 11  | `bagging-boosting-en.wav`   | Samantha  | 80   | 2.0   | before / after |
| 12  | `bagging-boosting-en.wav`   | Samantha  | 80   | 3.5   | before / after |

每个组合运行 3 次，检查结果稳定性。

**此前的 33-rate 扫描标记为 exploratory，不作为验收证据。**

### Harness 验证（V02-R03）

使用官方 test_wavs/0.wav 验证热词配置对解码的影响：

| score             | before (no hotwords) | after (hotwords)      | 差异            |
| ----------------- | -------------------- | --------------------- | --------------- |
| 1.5               | `...IS LIBR THE...`  | `...IS LIBR THE...`   | 无              |
| 3.5               | `...IS LIBR THE...`  | `...IS LIVE AFTER...` | `LIBR` → `LIVE` |
| 5.0 (exploratory) | `...IS LIBR THE...`  | `...IS LIVE AFTER...` | `LIBR` → `LIVE` |

**结论：在其他解码配置保持一致时，加入 hotwords 文件会在 score=3.5 时对官方 WAV 的解码结果产生可重复影响。**

score=5.0 不属于正式预声明矩阵，仅作为 exploratory 参考。正式证据只使用 1.5/2.0/3.5。

### 复现命令

```bash
cd tooling/voice-lab
npm ci

# Harness 验证（官方 WAV）
node run-compare.mjs --engine wasm --fixture 0.wav
node run-compare.mjs --engine wasm --fixture 0.wav \
  --hotwords fixtures/hotwords-official-test.txt --hotwords-score 3.5

# Bagging/Boosting 对照（矩阵中的每条命令）
node run-compare.mjs --engine wasm \
  --fixture fixtures/generated/bagging-boosting.wav \
  --hotwords fixtures/hotwords-bagging-boosting.txt \
  --hotwords-score 1.5 --output results/v02-r-f1-s1.5-run1.json

# 坏配置：显式报路径错误并以退出码 2 结束
node run-compare.mjs --engine wasm --fixture 0.wav \
  --hotwords fixtures/does-not-exist.txt
```

## V02-S：路线重选实验（正式矩阵已完成）

V02-R 的 TTS fixture 没有提供可验证的真实目标术语发音，因此不能继续作为唯一验收证据。
V02-S 改用项目负责人本人录制且明确授权用于本地测试的真人语音。正式音频仍被 `.gitignore`
排除；正式矩阵使用 manifest 固定来源、授权、格式和 SHA-256，manifest 本身也只保留在本地。

固定朗读文本：

> Bagging and boosting are two classic ensemble methods. Bagging reduces variance, while boosting reduces bias.

官方 sherpa-onnx 热词文档规定 English/BPE 热词使用大写形式，因此 V02-S 使用新的
`fixtures/hotwords-v02-s.txt`，内容为 `BAGGING` 和 `BOOSTING`。旧的
`hotwords-bagging-boosting.txt` 保留，只用于复现已经提交的 V02-R 证据。

### 模型与许可

正式矩阵只允许以下两个 profile；不得运行后再增加有利模型：

| profile                | 作用         | 语言     | 权重 | 官方来源                                                                                                                                                                  | 许可       |
| ---------------------- | ------------ | -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `current`              | 当前产品候选 | 中英双语 | FP32 | [bilingual 2023-02-20](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2)             | Apache-2.0 |
| `small-bilingual-fp32` | 双语替代候选 | 中英双语 | FP32 | [small bilingual 2023-02-16](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16.tar.bz2) | Apache-2.0 |

二者均为 sherpa-onnx 官方文档列出的中英双语 streaming transducer。热词只在
`modified_beam_search` 下使用。仅英语模型不能满足 EduCanvas 的双语课堂范围，因此不列入正式候选。

下载后必须先核对归档 SHA-256；不得用同名但内容不同的权重替代：

| profile                | archive SHA-256                                                    |
| ---------------------- | ------------------------------------------------------------------ |
| `current`              | `27ffbd9ee24ad186d99acc2f6354d7992b27bcab490812510665fa8f9389c5f8` |
| `small-bilingual-fp32` | `2b7c63322b32e5e0f2526043a1103366119ca58dd615cd7105a37c01db9553d7` |

small bilingual 官方归档不含 `bpe.vocab`。准备脚本会先验证它与 current profile 的
`bpe.model`、`tokens.txt` 分别字节一致，再从 current profile 复制已验证的
`bpe.vocab`；任一哈希不符都会显式失败：

```bash
cd tooling/voice-lab
node prepare-v02-s-model.mjs
```

本地 Node 22 工具链固定为官方 `node-v22.23.1-darwin-arm64.tar.gz`，归档 SHA-256 为
`ef28d8fab2c0e4314522d4bb1b7173270aa3937e93b92cb7de79c112ac1fa953`。Node 二进制和
模型一样只放在被忽略的 `models/`，不提交仓库。

### 正式控制变量和门槛

| 参数                 | 预声明值                                           |
| -------------------- | -------------------------------------------------- |
| engine               | `wasm`                                             |
| Node                 | 22.23.1、24.18.0                                   |
| decodingMethod       | `modified_beam_search`                             |
| maxActivePaths       | 4                                                  |
| chunkMs              | 100                                                |
| tailSeconds          | 1.5                                                |
| hotwords             | `BAGGING`、`BOOSTING`                              |
| hotwordsScore        | 1.5、2.0、3.5                                      |
| repetitions          | 每个 profile/Node/score 的 before 和 after 各 3 次 |
| 目标术语门槛         | after 必须在 3/3 中同时出现 BAGGING 与 BOOSTING    |
| 热词纠正门槛         | before 至少漏一个目标词，after 达到目标术语门槛    |
| RTF 上限             | 0.5                                                |
| 所需模型文件大小上限 | 250 MiB                                            |
| 峰值 RSS 上限        | 1.5 GiB                                            |

before/after 对同一 profile、Node 和 fixture 只允许热词文件不同。若 before 已在 3/3 中正确包含
两个术语，只能记为 `BASELINE_CAPABLE`，不能伪称热词完成纠正。正式矩阵全部完成前不做路线结论。
候选通过还要求同一 profile、同一 hotwordsScore 在 Node 22.23.1 与 24.18.0 上都达到
`hotwordCorrected`；单一 Node 或单一偶发结果不能产生 `PASS_CANDIDATE`。

正式矩阵只能在以下 manifest 落盘后启动：`fixtures/v02-s-human.json`。它必须包含本人录制、
仅限 EduCanvas 本地测试且不随 Git 发布的明确授权，固定朗读文本、16 kHz 单声道 PCM、相对
音频路径和 SHA-256。matrix runner 与 summary generator 共享同一个严格校验模块；音频本体继续
留在被忽略的 `fixtures/generated/`。

模型准备完成后的基础设施 smoke（不是目标词正式证据）显示 small bilingual FP32 能在 Node
22.23.1 与 24.18.0 上解码官方 `test_wavs/0.wav`，RTF 分别为 0.0867、0.0831；这只证明第二
候选可执行，不能替代真人 fixture 的 before/after 结论。

允许的最终判定只有：`PASS_CANDIDATE`、`BLOCKED_FIXTURE`、`BLOCKED_MODEL` 或
`REVISE_STRATEGY`。任何候选结果都需 Codex 复核，V03 在此之前保持锁定。

### 2026-08-04 正式结果

72 次正式运行全部完成且无崩溃，摘要见 `evidence/v02-s-summary.json`：

- `current-bilingual-fp32` 的 after 没有同时正确识别 `BAGGING` 与 `BOOSTING`，且模型权重
  356,862,456 bytes，超过 250 MiB 门槛；
- `small-bilingual-fp32` 的 before/after 均稳定包含两个目标术语，因此没有热词纠正增益；
  完整句仍存在大量替换错误，不能把仅命中两个词包装成产品质量通过；
- 最终 verdict 为 `BLOCKED_MODEL`，`blockerCode=target_terms_not_corrected`，V03 未解锁。

下一步是计划中的 V02-T：继续使用同一真人录音，评估 ADR 指定模型或一个许可明确的官方
流式双语候选，并将基础识别质量与热词增益拆成独立门槛。不得在 V02-T 通过前接入业务。

## V02-T：Paraformer INT8 模型策略实验

V02-T 评估 sherpa-onnx 官方发布的
`sherpa-onnx-streaming-paraformer-bilingual-zh-en` INT8 权重。归档 SHA-256 为
`5462a1fce42693deae572af1e8c4687124b12aa85fe61ff4d3168bb5280e205f`，实际所需权重与
tokens 共 237,202,501 bytes；runner 还会逐文件验证 encoder、decoder 和 tokens 的 SHA-256。
模型、归档、真人 WAV 和逐次结果仍全部留在被忽略目录。

正式矩阵沿用 V02-S 的真人录音，固定 WASM、100 ms 分块、1.5 秒尾静音，并在 Node
22.23.1 与 24.18.0 上各运行 3 轮 baseline 和 3 轮 hotword capability probe。摘要见
`evidence/v02-t-summary.json`。

结果：

- 两个 Node 的 baseline 各 3/3 稳定，`BAGGING`/`BOOSTING` 召回率均为 100%；
- baseline 归一化 WER 均为 0.6667，高于 0.35 门槛；
- baseline RTF 为 0.2246–0.2479，峰值 RSS 为 806,448–961,984 KiB，模型体积、速度和内存
  均在门槛内；
- 当前 sherpa-onnx 1.13.4 的在线 Paraformer 实现只支持 `greedy_search`，而 hotwords 配置要求
  `modified_beam_search`。因此 6/6 probe 均以稳定码
  `hotwords_not_supported_by_profile` 失败，未伪装为空转录或成功。

最终 verdict 为 `BLOCKED_MODEL`，`blockerCode=hotword_mode_unsupported`。基础质量与
热词能力均未通过产品门槛，V02 不改为 PASS，V03 不解锁。

复现：

```bash
cd tooling/voice-lab
npm test
npm run test:v02-t -- \
  --node22 models/node-v22.23.1-darwin-arm64/bin/node \
  --node24 /path/to/node-v24.18.0/bin/node
npm run summarize:v02-t
```

## 推荐与门禁

证据支持 **WASM SIMD 作为后续产品路线**：它在仓库支持的 Node 22/24 上均为 4/4 非空，
RTF 约 0.12，满足本 fixture 范围内的实时性；Node 20 仅作兼容实验，也为 4/4 非空。
原生 addon 在 Node 20/22/24 均为 0/4，虽更快但已被否决为产品路线。V01 因此 `PASS`；
V02-S 与 V02-T 已完成真人录音下的受控证据；现有 Zipformer 候选未同时满足术语和整句质量，
Paraformer INT8 又不支持当前热词解码路径且整句 WER 超限。V02 = `BLOCKED_MODEL`，
V03 仍 `BLOCK`，不得接入流式 Port、Gateway 或 UI，也不修改 ADR-0018 的 `accepted` 状态。

## 文件

- `run-compare.mjs`：统一 runner 和 JSON 证据（自动记录 SHA-256 哈希）
- `model-profiles.mjs`：V02-S/V02-T 预声明的官方模型、权重文件、语言范围、许可与能力
- `prepare-v02-s-model.mjs`：验证两个 profile 的文件哈希并安全准备共享 `bpe.vocab`
- `v02-s-fixture-manifest.mjs`：真人 fixture 来源、授权、文本、格式和哈希的唯一 schema
- `run-v02-s-matrix.mjs`：固定 Node/profile/score/repetition 的 72 次正式矩阵
- `generate-v02-s-summary.mjs`：从被忽略的原始结果生成有界 V02-S 证据摘要
- `evidence/v02-s-summary.json`：不含音频、模型或绝对路径的正式矩阵摘要
- `v02-s-evaluation.mjs`：跨 Node 候选门槛与稳定 verdict
- `run-v02-t-matrix.mjs`：固定 Node 和 repetition 的 Paraformer baseline/capability 矩阵
- `generate-v02-t-summary.mjs`：从被忽略的逐次结果生成 V02-T 有界摘要
- `v02-t-evaluation.mjs`：术语、WER、资源、热词能力与解锁门槛
- `evidence/v02-t-summary.json`：不含音频、模型或绝对路径的 V02-T 正式摘要
- `fixtures/hotwords-bagging-boosting.txt`：UTF-8 热词词表
- `fixtures/hotwords-v02-s.txt`：符合官方 English/BPE 规范的全大写 V02-S 热词词表
- `fixtures/hotwords-official-test.txt`：harness 验证用热词词表
- `generate-summary.mjs`：从 results/ 生成 evidence/v02-r-summary.json
- `test-v02-r.mjs`：V02-R2 测试套件
- `evidence/v02-r-summary.json`：精简证据摘要（被忽略）
- `test-native-addon.mjs`：历史 V01 最小复现，保留用于比较
