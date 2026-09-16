# DP12 macOS 打包准备

- 状态：`IN_PROGRESS`
- 准备时间：2026-09-16
- 执行计划：[DP 桌宠统一桌面外延](../../plan/active/DP-桌宠统一桌面外延.md)

本阶段已补齐可在 GitHub `macos-latest` 上执行的工程入口，但当前 Windows 主机不能替代
macOS 实机、Apple 签名和公证证据，因此不得标记为 PASS。

## 已完成

- electron-builder 配置 x64/arm64 的 DMG 与 ZIP 目标；
- hardened runtime、麦克风用途说明以及 audio-input/network-client entitlements；
- `package:macos` 开发者入口；
- Desktop CI 使用 Windows/macOS 原生 runner 矩阵，macOS 校验双架构产物并记录 SHA-256；
- 现有 `open-url`、单实例和受信 renderer 边界继续由 Desktop 自动化保护。

## CI 原生构建证据

2026-09-16 的 [GitHub Actions CI #35053823136](https://github.com/Timcai06/EduCanvas/actions/runs/35053823136)
已在 `macos-latest` 原生 runner 通过 `desktop-build (macos-latest, macos)`：执行 Desktop
测试、类型检查和 `package:macos`，随后确认生成 2 个 DMG 与 2 个 ZIP，并上传 7 天诊断
artifact。同一工作流的 Windows desktop-build 也通过。

该任务显式关闭证书自动发现，因此只证明 x64/arm64 工程构建与产物集合成立，不构成
Developer ID 签名、公证、stapling 或真实用户设备启动证据。

## 外部条件与实机矩阵

- [ ] Apple Developer ID Application 证书；
- [ ] notarization 凭据和 stapling；
- [ ] Intel 与 Apple Silicon 至少各一次启动验证；
- [ ] 冷启动/已运行 `educanvas://` 回跳；
- [ ] 麦克风权限首次请求、拒绝、重新授权和中文 ASR/TTS；
- [ ] 透明窗口、托盘、多屏、缩放、睡眠恢复和退出行为；
- [ ] 登录、Conversation、历史、流式、取消、结果卡、附件和精确 handoff 主流程。

上述项目必须在真实 macOS 上记录系统版本、硬件、产物 SHA-256、签名、公证和操作结果。
