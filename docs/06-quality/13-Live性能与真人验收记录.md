# Live 性能与真人验收记录

> 对应开发计划 L08。自动化、Ego 浏览器壳层、真实 Provider 与真人麦克风证据必须分开记录；
> fake 数据不能替代 Chrome/Safari 的真实体验结论。

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

- 工具：Ego Browser（Chromium），`http://127.0.0.1:3101/`。
- 已观察：Live 入口可用；进入后原生 `dialog` 挂载且 `open=true`；阶段从
  `connecting` 开始；真实资料投影使 `data-has-visual=true`；点击“结束 Live Voice”后
  对话框完成退场并卸载，外层聊天消息仍在。
- 未证明：麦克风采集、真实 DashScope TTS/ASR、三轮连续对话、工具调用语音连续性、
  Safari 行为和真实延迟。浏览器壳层观察不得写成真人验收 PASS。

## 3. 真人验收待填

每次记录浏览器版本、macOS 版本、服务端 model alias、开始时间和下列指标；不记录
API Key、学生内容、供应商原始响应或音频。

### Chrome

- [ ] 连续三轮对话，聊天账本无重复消息
- [ ] 一次真实工具调用，工具前后为同一 Assistant 消息且语音自然续接
- [ ] 一次插话，旧 PCM 立即静音且下一轮只提交一次
- [ ] 一次 TTS 失败，文字继续增长、Live 继续聆听并可恢复下一轮
- [ ] 记录首字、首音、段间隙、插话静音与 cancel 延迟

结果：`PENDING — 需要真实麦克风和 Provider`。

### Safari

- [ ] 连续三轮对话，聊天账本无重复消息
- [ ] 一次真实工具调用，工具前后为同一 Assistant 消息且语音自然续接
- [ ] 一次插话，旧 PCM 立即静音且下一轮只提交一次
- [ ] 一次 TTS 失败，文字继续增长、Live 继续聆听并可恢复下一轮
- [ ] 记录首字、首音、段间隙、插话静音与 cancel 延迟

结果：`PENDING — 需要真实麦克风和 Provider`。
