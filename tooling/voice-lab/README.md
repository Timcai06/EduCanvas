# Voice Lab

用于复现 sherpa-onnx 原生 addon 文件识别行为的实验环境。

**状态**: 仓库内手工复现工具，不纳入 CI；模型权重和测试音频只保存在本地。

## 环境信息

- **sherpa-onnx-node**: 1.13.4
- **Node.js**: v24.18.0
- **架构**: arm64 (Apple Silicon)
- **平台**: darwin (macOS)

## 验证结果

### V01: 原生 addon 最小可复现验证

**状态**: BLOCKED

**发现**:

1. 原生 addon 可以成功创建 `OnlineRecognizer`
2. **问题**: 所有测试音频（0.wav、1.wav、2.wav、3.wav）都返回空文本
3. 根因未知

**复现步骤**:

```bash
pnpm --dir tooling/voice-lab test:native
```

**预期结果**: 识别出中文文本
**实际结果**: 返回空字符串

脚本使用官方 Node addon 文件识别示例的全精度模型组合、`featConfig` 和 0.4 秒尾部静音。
路径相对脚本解析，不包含开发者机器的绝对目录。

**阻塞任务**: V02, V03, V04-V09, V12-V13, V16-V17

## 文件说明

- `test-native-addon.mjs`: 原生 addon 流式识别测试
- `models/`: 模型文件目录（不提交到仓库）
- `.gitignore`: 忽略本地模型、音频、压缩包和 `node_modules`

## 注意事项

- 模型文件不提交到仓库（遵循 CLAUDE.md 规定）
- 不提交密钥、原始音频、学生数据
- 不提交不可复现的口头结论
