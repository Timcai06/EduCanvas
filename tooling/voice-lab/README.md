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

## V02 热词

热词文件使用 UTF-8、每行一个术语；此处的最小词表为 `Bagging` 与 `Boosting`。
启用热词会同时配置 `modelingUnit: 'cjkchar+bpe'`、模型的 `bpe.vocab`，并改用
`modified_beam_search`。后者是 sherpa 的前置条件：与 `greedy_search` 组合时，
两个引擎都会在构造 recognizer 时明确失败，不能把失败误报为热词无效。

```bash
# 以下两条从 tooling/voice-lab/ 目录执行。
# 对相同 fixture 做 before（无 --hotwords）和 after（有 --hotwords）
node run-compare.mjs --engine both --fixture 0.wav

# 待 owner 在 fixtures/generated/ 提供被忽略、有效的目标词 WAV 后才运行：
npm run test:hotwords

# 坏配置：显式报路径错误并以退出码 2 结束
node run-compare.mjs --engine wasm --fixture 0.wav \
  --hotwords fixtures/does-not-exist.txt
```

2026-07-29 的 after：Node 24.18.0 上 WASM 对 `0.wav` 输出与 before 相同（该官方
fixture 不含目标词）；原生仍为空，进程退出码为 1。缺失热词文件在调用引擎前
显式以退出码 2 失败。当前模型附带的官方 WAV 没有 `Bagging/Boosting` 对照，且本机
`say -v Tingting` 生成了零样本音频，故**尚未得到目标词的 before/after 效果证据**。
不得以不含目标词的输出不变宣称热词无效，也不得以字符串替换伪造通过。

要完成 V02，owner 需提供一个无个人信息、16 kHz、含该句的有效 fixture 到被忽略的
`fixtures/generated/bagging-boosting.wav`，再从仓库根运行
`npm run test:hotwords --prefix tooling/voice-lab`。
验收要求是 before 可复现术语误识别、after 正确识别且 WASM 进程不崩溃。

## 推荐与门禁

证据支持 **WASM SIMD 作为后续产品路线**：它在仓库支持的 Node 22/24 上均为 4/4 非空，
RTF 约 0.12，满足本 fixture 范围内的实时性；Node 20 仅作兼容实验，也为 4/4 非空。
原生 addon 在 Node 20/22/24 均为 0/4，虽更快但已被否决为产品路线。V01 因此 `PASS`；
V02 缺少有效的 `Bagging/Boosting` before/after fixture，V03 仍 `BLOCK`，不得接入流式
Port、Gateway 或 UI，也不修改 ADR-0018 的 `accepted` 状态。

## 文件

- `run-compare.mjs`：统一 runner 和 JSON 证据
- `fixtures/hotwords-bagging-boosting.txt`：UTF-8 热词词表
- `test-native-addon.mjs`：历史 V01 最小复现，保留用于比较
