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

## 推荐与门禁

证据支持 **WASM SIMD 作为后续产品路线**：它在仓库支持的 Node 22/24 上均为 4/4 非空，
RTF 约 0.12，满足本 fixture 范围内的实时性；Node 20 仅作兼容实验，也为 4/4 非空。
原生 addon 在 Node 20/22/24 均为 0/4，虽更快但已被否决为产品路线。V01 因此 `PASS`；
V02 已完成受控、单变量 before/after，harness 配置对官方 WAV 解码有可重复影响，
但 Bagging/Boosting 在 score 1.5/2.0/3.5 下均未纠正，V02 = `BLOCKED`，
V03 仍 `BLOCK`，不得接入流式 Port、Gateway 或 UI，也不修改 ADR-0018 的 `accepted` 状态。

## 文件

- `run-compare.mjs`：统一 runner 和 JSON 证据（自动记录 SHA-256 哈希）
- `fixtures/hotwords-bagging-boosting.txt`：UTF-8 热词词表
- `fixtures/hotwords-official-test.txt`：harness 验证用热词词表
- `generate-summary.mjs`：从 results/ 生成 evidence/v02-r-summary.json
- `test-v02-r.mjs`：V02-R2 测试套件
- `evidence/v02-r-summary.json`：精简证据摘要（被忽略）
- `test-native-addon.mjs`：历史 V01 最小复现，保留用于比较
