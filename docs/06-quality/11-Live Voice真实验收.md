# Live Voice 真实交互验收

> 状态：`NOT_RUN`
>
> 执行人：项目负责人
>
> 边界：Ego 只在正常本地服务状态下观察；Codex 不为此启动、停止或重启服务。

## 证据分层

本记录只承接真人麦克风、真实浏览器和真实 Provider 的交互结论。PR 中的
fake-provider E2E 证明协议与生命周期，受保护 Provider Canary 证明云端 adapter
可用性；两者都不能替代本页的听感、插话时机与沉浸式体验验收。

音频本体、Prompt、Provider 原始响应、Secret 和学生内容不得提交仓库。记录只写
浏览器/系统版本、目标 SHA、配置别名、稳定错误码、可复现步骤和 PASS/FAIL。

## 一次完整验收

- [ ] macOS Chrome Dictation：开始/停止、实时文字、草稿可编辑、零自动发送。
- [ ] macOS Safari Dictation：同上，并记录权限与 AudioContext 行为差异。
- [ ] Live 连续三轮：字幕与语音语义一致，段间无明显断裂，聊天历史正确落在外层。
- [ ] 插话一次：声音立即停止，旧 Turn 取消，新 final 只提交一次并恢复聆听。
- [ ] 图片与文档：ready immutable version 被带入，processing 来源明确提示本轮排除。
- [ ] Provider 故障恢复：Live 降级或恢复不影响 Dictation 与文字聊天。
- [ ] reduced-motion：信息完整、无持续装饰动画，不影响字幕、静音和结束操作。
- [ ] 沉浸式体验：全屏焦点、键盘退出、移动端安全区、球体反馈和字幕可读性可接受。

## 记录模板

```text
Target SHA:
macOS / Browser:
DashScope ASR/TTS aliases:
Scenario:
Observed stable code (if any):
Result: PASS | FAIL
Notes:
```

发现缺陷时另开单一职责修复，并只重跑受影响自动化/真人证据；不得把一次人工 PASS
写成对所有浏览器、网络和课堂声学条件的普遍保证。
