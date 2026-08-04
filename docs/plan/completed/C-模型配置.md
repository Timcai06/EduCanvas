# 模型能力独立 Provider 配置

- 任务分配名：`C 模型配置`
- 状态：`completed`
- 负责人：项目负责人
- 代码审核与最终验收：Codex
- 依赖决策：[ADR-0021](../../09-decisions/0021-模型能力独立Provider与继承规则.md)
- 当前领取任务：无；`C00-C04` 已由 Codex 复审并随 PR #274 合并

## 一、目标

在不改变唯一 Agent Loop 和 Model Gateway 适配边界的前提下，用统一 capability framework
覆盖 Text、Vision、Speech、Transcription、Image 与 Embedding。Text 当前继续作为主
Provider 默认实现，但配置语义也受统一框架约束；未配置媒体 override 时，仅在主 Provider
明确支持该能力时整组继承，否则只关闭该能力。

## 二、原子任务

### 配置事实矩阵（C00）

| 能力          | Provider/模型来源                                                               | 未配置时语义                             | 组合根                               |
| ------------- | ------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------ |
| text          | 主 `MODEL_GATEWAY_PROVIDER`、Base URL、Key、primary/fast/structured             | 主 Provider 未配置则 Agent 模型能力关闭  | Web/Gateway 既有 Turn 组合           |
| vision        | ADR-0017 的 `MODEL_GATEWAY_VISION_*` 独立配置                                   | 未配置则图片输入关闭；旧变量保持兼容     | Web 图片输入路由                     |
| speech        | `MODEL_GATEWAY_SPEECH_PROVIDER/MODEL/BASE_URL/API_KEY/TIMEOUT_MS`               | 主 Provider 支持且有模型时继承，否则关闭 | Worker `resolveSpeechModelGateway()` |
| transcription | `MODEL_GATEWAY_TRANSCRIPTION_PROVIDER/MODEL/BASE_URL/API_KEY/TIMEOUT_MS`        | 同上                                     | Worker 一次性音频转录                |
| image         | `MODEL_GATEWAY_IMAGE_PROVIDER/MODEL/BASE_URL/API_KEY/TIMEOUT_MS`                | 同上；关闭时 Web 不注册图像工具          | Web 能力判定 + Worker 图像生成       |
| embedding     | `MODEL_GATEWAY_EMBEDDING_PROVIDER/MODEL/BASE_URL/API_KEY/TIMEOUT_MS` + 模型版本 | 同上；关闭时检索诚实降级为纯词法         | Web/Worker 检索与摄取                |

负例统一语义：未知 Provider、非法模型、半配置、非法 URL/Key、越界 timeout/配额和缺失
embedding 版本都只关闭对应媒体能力；主文本配置保持可用。`env:check` 仍以非零退出暴露部署
错误，但不得打印 Key、带凭据 URL 或原始异常。

### C00：配置事实与命名冻结

- 盘点主配置、Vision 配置、media aliases、Web/Worker composition 和 `.env.example`；
- 为每项能力固定 Provider/Model/Base URL/API Key/Timeout 的字段与继承矩阵；
- 明确不同 Provider 的字段不能隐式拼接，能力专属上限不伪装成通用 Token 配置。

完成标准：形成当前/目标映射和负例表；没有代码修改。

### C01：纯配置解析与契约测试

- 在 `packages/model-gateway` 实现可复用的 capability override 解析；
- 覆盖完整 override、合法整组继承、部分配置、未知 Provider、能力不兼容和 Secret 缺失；
- 配置错误只禁用对应能力，不拖垮文本 Agent。

### C02：Web 与 Worker 组合

- Web/Worker 通过同一解析结果构造对应 Gateway；
- Provider SDK 类型、原始响应和 Secret 继续止于 `packages/model-gateway`；
- 不为某一能力复制特例 resolver，不改变 Agent Runtime 调用语义。

### C03：环境检查与迁移文档

- 更新 `.env.example`、env-check、README/operations 配置参考；
- env-check 只输出能力状态和稳定错误码，不打印 Key、Base URL credential 或原始错误；
- 旧 Vision 配置保持兼容，记录废弃窗口而非立即破坏。

### C04：跨能力验收

- 使用不同 Provider fixture 证明 text、vision、speech、transcription、image、embedding 可独立
  启用、继承或关闭；
- 覆盖 DeepSeek 文本 + 独立 Speech/Transcription 的目标部署；
- 相关 test/typecheck/env-check/tooling 通过并由 Codex 最终复审。

## 三、验证台账

| 任务 | 最终结论 | 证据                                                                                      |
| ---- | -------- | ----------------------------------------------------------------------------------------- |
| C00  | `PASS`   | 本文配置事实矩阵、继承规则与负例语义                                                      |
| C01  | `PASS`   | `config-capability.ts` 及解析、隔离、非法能力配置不拖垮主文本的测试                       |
| C02  | `PASS`   | Web/Worker 共用 `resolveCapabilityGatewayConfiguration()`                                 |
| C03  | `PASS`   | `.env.example`、`env-check.mjs`、模型路由文档                                             |
| C04  | `PASS`   | 六类能力验收、DeepSeek 文本与独立 Vision 组合证据；PR #274 全量 CI 通过并合并为 `27f2d81` |

## 四、任务提示词

```text
只执行 C 模型配置计划当前领取的一个原子任务。先读 AGENTS.md、CLAUDE.md、ADR-0017、
ADR-0021、packages/model-gateway 配置与 Web/Worker composition。所有 shell 命令以 rtk 开头。

Provider 响应视为不可信；SDK 类型、原始响应和 Secret 不得离开 model-gateway。不能用 Speech
一次性特例绕过通用解析，不能把不同 Provider 的 Base URL/API Key 拼接，不能因媒体配置错误
拖垮文本 Agent。不得修改 Agent Loop，不得调用真实付费 Provider，不得替 Codex 宣布 PASS，
不得提交、推送或合并。

回报必须包含：基线 SHA、修改文件单一职责、配置矩阵、验收标准到测试的映射、命令与退出码、
未运行项、安全边界、残余风险、回退方式、git diff --check/name-status/status。
```
