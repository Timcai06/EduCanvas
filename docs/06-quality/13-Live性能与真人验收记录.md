# Live 性能与真人验收记录

> 对应开发计划 L08。自动化、Ego 浏览器壳层、真实 Provider 与真人麦克风证据必须分开记录；
> fake 数据不能替代 Chrome/Safari 的真实体验结论。

## 0. 验收结论

- 主线提交：`87f78f94e87041d7e9fb68e0e0ccb3224d1f8eb1`（PR #363）。
- 自动化结论：PR #363 的静态质量、测试、Agent Eval、E2E 与 secret scan 全部通过；L06、
  L07 据此判定 `PASS`。
- 真人结论：`PASS`。项目负责人已于 2026-08-12 完成真实麦克风与真实 DashScope
  Provider 验收，并明确签署 L08 通过；未记录的浏览器精确版本和逐项延迟数值不得由
  自动化结果补写或推测。
- 本轮候选修复：TTS 的 256 KiB 播放信用窗口改为 ACK 驱动的暂停/继续，不再把约
  5.3 秒预排音频误判为背压失败；连续 delta 空闲 18 秒时主动结束 Provider task，
  后续 burst 接力；两字播放回声纳入插话过滤。真人验收需同时观察长回答和扬声器回声。

## 1. 自动化预算

预算来源：`docs/plan/active/LC-Live与Canvas输出产品化.md` 第五节。

| 指标                  | 自动阻断预算（p95） | fake harness 状态                               |
| --------------------- | ------------------: | ----------------------------------------------- |
| delta 到聊天文字提交  |              100 ms | 已覆盖                                          |
| 可朗读边界到 TTS 提交 |              300 ms | 已覆盖                                          |
| TTS 首 PCM 到播放排期 |              120 ms | 已覆盖                                          |
| 连续短语播放空隙      |              120 ms | 已覆盖；按 Web Audio 窗口测量，不用提交墙钟代替 |
| 插话到本地静音        |              120 ms | 已覆盖                                          |
| 插话到 cancel 发出    |              150 ms | 已覆盖                                          |

实现位于 `apps/web/features/voice/performance/`。测试使用注入的单调时钟和 fake
SSE/TTS/PCM marker；缺少任一指标样本时 fail closed，不调用真实供应商。

## 2. 2026-08-12 本地壳层验证

- 工具：Ego Browser（Chromium），`http://localhost:3101/`。
- 已观察：已登录上下文的 capability 中 `model`、`connection`、`speech` 均为健康；Live
  入口可用，进入后原生 `dialog` 挂载且 `open=true`，状态进入“正在聆听 / 我在听”；真实
  资料投影使 `data-has-visual=true`；点击“结束 Live Voice”后对话框完成退场并卸载，外层
  聊天消息仍在。
- 未证明：麦克风采集、真实 DashScope TTS/ASR、三轮连续对话、工具调用语音连续性、
  Safari 行为和真实延迟。浏览器壳层观察不得写成真人验收 PASS。

### 2.1 真实 DashScope 长回答背压验证

- 链路：真实 DashScope TTS Provider → `StreamingSpeechChannel`，使用默认 256 KiB 浏览器
  播放信用窗口；首批 ACK 人为延迟 8 秒，随后按序异步确认。
- 结果：`speech.finished`；无 `speech.failed`；共 223 个 PCM 帧、1,605,120 字节，
  最大单帧 8,000 字节，总量约为旧信用窗口的 6.1 倍。
- 证明范围：真实 Provider 输出超过旧窗口时，Gateway 会等待浏览器信用并在 ACK 后继续，
  不再把正常长回答误判为 `BACKPRESSURE_EXCEEDED`。
- 未证明：扬声器回声下的真实插话判定、WebSocket 网络抖动、Web Audio 实际播放完成时间和
  Chrome/Safari 麦克风体验；这些仍由下方真人验收负责。

### 2.2 新 TTS profile 往返探针

- 时间：2026-08-12；入口：`tooling/evals/provider-canary/run.ts`。
- 配置：`qwen-audio-3.0-tts-flash + longanhuan_v3.6`，24 kHz PCM；ASR 保持
  `paraformer-realtime-v2`。
- 结果：2 个冻结场景、4 次 Provider operation，成功率 100%，p50 1,604 ms、
  p95 1,629 ms。
- 证据边界：本次本地探针运行在 LX 提交前，因此只证明显式环境 profile 的真实
  TTS → 重采样 → ASR 往返可用，不证明未来提交 SHA 的远端部署。提交后须通过受保护
  Provider Canary 生成带 SHA 与闭集 `providerProfile` 的正式 artifact。

## 3. 真人验收签署

每次记录浏览器版本、macOS 版本、服务端 model alias、开始时间和下列指标；不记录
API Key、学生内容、供应商原始响应或音频。

### Chrome

- [x] 连续三轮对话，聊天账本无重复消息
- [x] 一次真实工具调用，工具前后为同一 Assistant 消息且语音自然续接
- [x] 一次插话，旧 PCM 立即静音且下一轮只提交一次
- [x] 一次 TTS 失败，文字继续增长、Live 继续聆听并可恢复下一轮
- [x] 项目负责人确认交互性能可接受；逐项延迟未留存，不补造数值

结果：`PASS — 项目负责人 2026-08-12 签署`。

### Safari

- [x] 连续三轮对话，聊天账本无重复消息
- [x] 一次真实工具调用，工具前后为同一 Assistant 消息且语音自然续接
- [x] 一次插话，旧 PCM 立即静音且下一轮只提交一次
- [x] 一次 TTS 失败，文字继续增长、Live 继续聆听并可恢复下一轮
- [x] 项目负责人确认交互性能可接受；逐项延迟未留存，不补造数值

结果：`PASS — 项目负责人 2026-08-12 签署`。
