# ADR-0007：真实教学 Turn 与 Provider 治理

- 状态：`accepted`
- 日期：2026-07-15
- 负责人：@Timcai06
- 实现入口：`packages/teaching-core/src/model-contracts.ts`、`packages/teaching-runtime/src/turn-orchestrator.ts`、`packages/model-gateway/src/openai-compatible-turn-model-gateway.ts`

## 背景

原有 `ModelGateway` 只有 `generateStructured()`，`TeachingTurnOrchestrator` 先生成结构化 `TeachingTurnPlan`。这个路径可以确定性测试工具授权，却不能支撑学生可见的真实流式回答；工具执行后也没有第二次模型合成。若 Web、AI SDK 或具体供应商各自定义流事件、模型名和错误，会让供应商细节侵入教学核心，也无法证明一次成功老师回答确实来自 Provider。

## 决定

1. `teaching-core` 拥有供应商无关的 `TaskAlias`、`ModelAlias`、`StreamTurnTextRequest`、`TurnModelEvent`、`ProviderCallMetadata` 和 `NormalizedModelError`；供应商 SDK 类型、原始 chunk 和模型 ID 不得越过 Adapter；
2. 正常教学轮次唯一进入 `TeachingTurnOrchestrator.streamTurn()`，并且只调用 `TurnModelGateway.streamTurnText()`：
   - 直答：一次 `phase=answer`；
   - 工具：一次 `answer` 请求工具，runtime 执行后进行唯一一次 `phase=synthesis`；
   - 每个 Turn 硬上限两次模型运行，不存在第三次隐藏规划调用；
3. `answer` 文本与工具调用互斥。若 Provider 先发文本后发工具，已到达的文本可以作为 partial 流事件被观察，但本轮必须收敛为 `INVALID_MODEL_STREAM`，不能完成为老师回答；
4. 工具调用使用 `callId / tool / JSON arguments delta / done` 的归一化分片。runtime 负责顺序组装、大小限制、JSON 解析、Schema与权限校验；
5. `synthesis` 请求携带自包含的 `callId / tool / 已验证 arguments / 已验证 output`，Adapter 必须能够无状态重建供应商所需的 assistant tool call 与 tool result 消息；
6. `generateStructured()` 的任务类型明确排除 `teaching.turn`，只保留给受控 Artifact 和非 Turn 结构化任务；
7. `TaskAlias` 表示业务目的，`ModelAlias` 表示路由档位。业务代码不得用供应商模型 ID、价格档位名称或供应商名代替二者；
8. Adapter 可以使用 Vercel AI SDK，也可以原生解析 SSE。只有 response ID、tool call ID、usage、finish reason、revision/fingerprint 和 Abort 均可无损归一化时才采用 AI SDK；否则使用原生解析；
9. DeepSeek 首版只允许在 local/development/shared-dev/test 显式开启并处理合成输入，staging/production 无条件硬拒绝。路由模型 ID 必须在配置中跟随官方当前版本，不把已公告停用的历史名称写成默认值；流式 usage chunk 必须正确处理，`reasoning_content` 永不持久化或返回客户端。
10. answer 的 `promptHash` 必须来自 runtime 导出的唯一纯材料构建函数；材料包含 task/model alias、phase、Prompt 版本、消息与工具定义，不包含尚未生成的 turnId、Trace、signal 或 secret。Orchestrator 必须复用同一材料，禁止组合根复制 Prompt 模板。

## 原因

- 领域 runtime 可以证明直答一次、工具路径两次，不会退化为披着 Agent 外衣的任意脚本或无限循环；
- Web、Provider 和持久化可围绕同一稳定协议独立演进；
- 增量 delta 能在 Provider 终态前到达应用层，同时畸形流仍有稳定失败边界；
- 自包含工具交换允许无状态 Adapter、进程重启后的审计和确定性 Fixture；
- 供应商替换只改变路由配置和 Adapter，不改变教学状态机、工具策略或浏览器协议。

## 后果

- 首个真实 Adapter 已由 `packages/model-gateway` 以原生 `fetch` + SSE 实现；未配置 Provider 仍返回 disabled，不能伪装为可用；
- DeepSeek 需要显式开发环境开关且在 staging/production 硬拒绝。因 EduCanvas 不保留 CoT，DeepSeek 请求固定关闭 thinking，并忽略响应中的 `reasoning_content`；
- Tool path 的首轮文本不能作为最终回答；部分畸形文本可能已通过 SSE 到达客户端，UI 必须在 `turn.failed` 后明确标记失败而不是保留为完成消息；
- 所有 Adapter 必须完整消费流末尾 usage/终态，并把异常映射为稳定错误；
- `ScriptedModelGateway` 只能位于测试入口，生产依赖边界测试需持续禁止 Web 导入。

## 验证方式

- 类型测试证明 `teaching.turn` 不能进入结构化请求；
- 契约测试覆盖 delta、分块工具参数、usage、completed、failed、Abort和畸形事件；
- Orchestrator 测试证明首个 delta 在 Provider 终态前可消费；
- Orchestrator 测试证明直答一次、工具路径严格两次且 synthesis 不再获得工具；
- Prompt 材料测试证明相同输入序列化稳定、模板由精确断言保护，且运行期字段不会污染 `promptHash`；
- Adapter Fixture 覆盖任意字节分片、首 delta、工具回放、usage、Abort、超时、429、内容过滤、畸形 SSE、响应资源释放与 secret/CoT 边界；
- 边界扫描确认 core/runtime/Web 不导入供应商 SDK，生产代码不导入 Scripted Gateway。
