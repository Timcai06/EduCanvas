# 桌宠真实语音链路（P2）实现计划

> 日期：2026-08-11
> 分支：`feat/20260811-desktop-p2-voice`
> 依据：ADR-0024、P1 桌宠 spec、`apps/desktop` 模块设计

## 目标

把 P1 的假演示时序替换成真实的单轮语音纵切：

```text
点击桌宠
  -> 申请麦克风并 listening
  -> 本地 VAD 判断说完（也允许再次点击取消）
  -> transcribing（云端整段 ASR）
  -> thinking（复用现有 assistant turn）
  -> speaking（云端非流式 MP3 TTS + 同步字幕）
  -> success -> idle
```

TTS 失败时保留字幕并按成功收敛；麦克风、空语音、ASR、Agent、TTS 和本地
服务错误都投影为稳定、可重试的用户状态。原始音频只在 Renderer/Main/Web
请求链内短暂存在，不落盘、不写日志、不进入 DB。

## 范围与非目标

P2 包含：

- Electron 麦克风权限闸门、MediaRecorder 采集、本地能量 VAD；
- WebM/Opus 整段 ASR、现有 assistant turn、Provider-neutral MP3 TTS；
- 取消、超时、空语音、字幕、失败降级、重试；
- 交互时展开的轻量气泡与透明区域鼠标穿透；
- Windows 本机开发态验证，macOS 代码路径保持一致。

P2 不包含：

- OAuth/deep link 与远端 Client session（P3）；
- Web/Canvas handoff（P4）；
- 持续监听、唤醒词、流式 ASR、全双工或自然打断；
- 语音历史、原始音频留存、Schema/Migration；
- 最终角色美术与双平台签名安装包（P5）。

## 研究与设计依据

### 用户与场景

目标用户是坐在电脑前的 K12 学生，核心任务是无需键盘即可向同一个
EduCanvas 助手发出短指令。首要心智模型是“点一下开始听，再点一下取消”，
而不是进入第二个聊天应用。

### 相邻产品

- ChatGPT Voice：语音同时保留文字，说明字幕是可靠的可访问性与失败降级层；
- ChatGPT Dictation：把单段录音与实时对话区分，支持本阶段采用 turn-by-turn；
- Microsoft Copilot Voice：首次使用才请求麦克风，结束后保留 transcript；
- Siri on Mac：短命令、即时系统反馈，避免把轻入口扩成复杂工作区；
- P1 桌宠：像素角色、状态 sprite、拖动和托盘是已批准的本项目视觉基线。

刻意差异：EduCanvas 不进入独立全屏语音模式；角色留在桌面原位，只在需要时
向左上方展开一张短字幕气泡。

### 外部视觉参考

- 8/16-bit RPG 对话框：角色与短文本空间关系清楚，适合像素角色；
- 课堂便签：暖中性色纸面承载文字，紫色只作为角色/主动作强调；
- 系统通知：短、可扫读、自动收起，但错误保留恢复动作。

## 关键架构决定

### 1. 录音与 VAD

采用 Chromium `MediaRecorder` 生成 `audio/webm;codecs=opus`，同时用
`AnalyserNode` 读取时域能量供本地 VAD。拒绝两个替代：

- 不复用 `ScriptProcessorNode` PCM 采集器：该 API 已废弃；
- 不在 P2 引入 AudioWorklet PCM 管线：对整段 ASR 属于额外复杂度，P2 不需要
  逐块网络发送。

VAD 规则为纯状态机：检测到有效语音后连续静音 900ms 自动结束；8s 内没有
说话报空语音；单次硬上限 30s。阈值与时间通过单测锁定，不依赖 wall clock。

### 2. 服务端能力

- 扩展 `POST /api/v1/voice/dictation`：继续支持严格 PCM WAV，同时增加
  `audio/webm` 魔术字节校验与相同 2MiB 上限；
- 新增 `POST /api/v1/voice/speech`：校验短文本，调用
  `OpenAICompatibleSpeechModelGateway`，返回 `audio/mpeg`；
- Electron 新增 `voice-proxy.ts`：只访问本地 Web BFF，并把错误归一化为稳定码；
- Provider 配置与 Secret 不进入 main/preload/renderer。

### 3. 状态与取消

新增独立 `VoiceSessionState`：

```text
idle | starting | listening | transcribing | thinking |
speaking | success | error | cancelled
```

它投影到既有 6 个视觉 sprite：starting/listening -> listen，
transcribing/thinking -> think，speaking -> speak。业务状态不污染角色包契约。
每轮会话持有一个 AbortController；取消会停止 MediaRecorder、麦克风 track、
网络请求和音频播放，迟到结果按 session id 丢弃。

### 4. 字幕气泡与窗口

折叠仍为 128x128；交互时扩展为 360x232，角色固定在右下角，气泡位于左上。
窗口缩放保持角色右下锚点不跳动并重新做多屏钳制。透明区域用
`setIgnoreMouseEvents(true, { forward: true })` 穿透，Renderer 进入角色或气泡
交互区时临时恢复鼠标事件。

设计 token：8px spacing grid；气泡背景暖白、深紫灰正文、角色紫仅作主强调；
正文 14px/1.4，状态标签 12px，按钮最小 44px 高；无渐变、玻璃、阴影堆叠。

## 测试驱动任务

### Task 1：Web ASR/TTS BFF

1. 先写 dictation WebM 合法/非法/超限测试并确认失败；
2. 最小实现内容类型和魔术字节校验；
3. 先写 speech route 的鉴权、校验、成功、Provider 失败、取消测试并确认失败；
4. 实现 speech gateway resolver 与 route；
5. 运行 web 相关测试与 typecheck。

### Task 2：Electron voice proxy 与权限边界

1. 先写 transcribe/synthesize 成功、HTTP 错误、超时、取消、离线测试；
2. 实现 `voice-proxy.ts` 与稳定共享结果类型；
3. 先写允许/拒绝麦克风权限来源的纯策略测试；
4. 在 main 注册 session permission handler 与 voice IPC；
5. preload 只暴露受限的 `transcribe`/`synthesize` 方法。

### Task 3：Recorder、VAD 与播放

1. 先写 MIME 选择、VAD 语音后静音、无语音超时、硬上限测试；
2. 实现可注入的 MediaRecorder/Analyser 录音器；
3. 先写 MP3 playback 的取消与终态协调测试；
4. 实现 Web Audio `decodeAudioData` 播放器。

### Task 4：语音会话与 UI

1. 先写 `VoiceSessionState` 转换与 sprite 投影测试；
2. 先写整轮 orchestrator：成功、取消、空语音、ASR/Agent/TTS 失败降级测试；
3. 实现会话 controller/hook，删除 `pet-demo.ts` 引用；
4. 实现字幕气泡、状态文案、重试/收起、键盘可用的角色按钮；
5. 先写保持右下锚点的窗口 resize 纯函数测试，再接 main/preload IPC；
6. 接透明区域穿透 IPC。

### Task 5：验证

- desktop + web 相关单测；
- desktop/web typecheck、desktop build、Prettier、file governance；
- Electron 本机：权限、自动停录、取消、字幕、TTS、错误重试、拖动、托盘；
- 确认无音频文件、日志、DB 或 Provider Secret 新增。

## 官方实现依据

- Electron BrowserWindow：`setIgnoreMouseEvents` 与 `forward`；
- Electron Security：显式处理 session permission request，默认拒绝未授权能力；
- MDN `getUserMedia()`：只在用户动作后请求，安全上下文与权限要求；
- MDN `ScriptProcessorNode`：已废弃，由 AudioWorklet 替代；本阶段使用
  MediaRecorder + Analyser 避免进入废弃采集路径。
