# ADR-0011：Answer 阶段允许工具调用前导文本

- 状态：`accepted`
- 日期：2026-07-16
- 负责人：@Timcai06
- 修订对象：[ADR-0007](0007-real-turn-and-provider-governance.md) 第 3 条（其余条款不变）

## 背景

ADR-0007 第 3 条规定 answer 文本与工具调用互斥：若 Provider 先发文本后发工具，本轮必须收敛为 `INVALID_MODEL_STREAM`。实现位于 `turn-orchestrator.ts` 的 `validateModelRun`（text 后见 tool_call、tool_call 后见 text 均判死），且该失败 `retryable: false`，学生端呈现为无法重试的中断。

真实 Provider 的惯常行为与该规则冲突：模型在请求工具前先输出一句过渡文本（"让我先了解一下你的学习状态"）是 OpenAI-compatible 生态的普遍模式。系统提示 `turn-answer-v3` 已明确写入"如果请求工具，不要同时输出面向学生的最终答案"，DeepSeek 仍然先输出文本再请求工具——提示词约束已被实证无效。

2026-07-16 本地真实调用账本（DeepSeek v4，n=5 次 answer 运行）：1 次成功（纯文本直答）、4 次失败；失败消息中至少 3 条留有"完整问候/过渡文本 + 随后请求工具"的指纹。**工具路径成功率为 0**。该规则把 Provider 的正常行为定义成了协议违规。

## 候选方案

- **A. 维持互斥并强化提示词**：已被证据否定——现行提示词已禁止该行为，模型照发；且失败不可重试，用户无路可走；
- **B. 容忍前导文本但丢弃**：文本以 SSE 增量实时到达客户端，事后丢弃要求 UI 撤回已渲染内容，体验割裂且浪费模型已生成的合理开场；
- **C. 前导文本保留为回答第一段（本决定）**：与 Gemini 式"先说明意图 → 工具执行 → 继续作答"的体验一致。

## 决定

1. answer 阶段允许"文本 → 工具调用"顺序：前导文本照常流式呈现，并持久化为助手消息的开头；
2. 工具执行完成后，synthesis 输出追加在前导文本之后（空行衔接），二者共同构成最终助手消息；
3. 以下仍判 `INVALID_MODEL_STREAM`，不放宽：工具调用之后再出现文本（tool_call 后 text_delta）、synthesis 阶段出现任何工具调用、`finishReason` 与是否存在工具调用不一致、空运行（无文本且无工具）；
4. 前导文本与 synthesis 文本共享 `MAX_RESPONSE_CHARACTERS` 上限，跨阶段累计；
5. 存在工具调用时，前导文本不得单独作为完成的老师回答——synthesis 失败则整轮失败，前导文本随轮次标记失败，不得伪装为完整回答；
6. ADR-0007 其余条款（每 Turn 两次模型运行上限、自包含 synthesis 交换、别名治理、DeepSeek 环境门控等）全部不变。

## 原因

- 协议应当描述"可验证的安全边界"，而不是"模型理想行为"；前导文本不越权（不判分、不转移状态、不暴露工具参数），禁止它换不来任何安全收益，只换来全量失败；
- 前导文本天然是流式 UX 的一部分，保留它与 SSE 增量交付的现有协议零冲突，UI 无需改动；
- 失败语义收敛到真正的违规（工具后补文本、synthesis 越权调工具），`INVALID_MODEL_STREAM` 恢复"畸形流"的本义，账本统计重新可信。

## 后果

- `validateModelRun` 调整：`hasText` 不再阻止后续 tool_call；`hasText === hasTools` 检查改为只拒绝双空；tool_call 之后出现 text_delta 仍判死；
- Orchestrator 需把 answer 阶段已流出的文本并入最终消息组装（含持久化与刷新恢复路径，注意 ADR-0008 的消息重建）；
- 契约测试与 Adapter Fixture 需补充"文本 → 工具调用"分片序列（建议直接采自 DeepSeek 真实事件序列）；
- ADR-0007 第 3 条在原文标注"由 ADR-0011 修订"，整篇维持 `accepted`。

## 验证方式

- Orchestrator 单元测试：text→tool_call 顺序完成两阶段并输出"前导 + synthesis"合并消息；tool_call→text 仍失败；字符上限跨阶段累计生效；synthesis 失败时前导文本不得标记为完成回答；
- 回放测试：用 Scripted Gateway 回放 2026-07-16 账本中失败轮次的真实分片序列，确认修复后成功完成；
- 上线后观察 `model_runs.error_code = 'invalid_response'` 占比：预期从工具路径 100% 降至个位数。
