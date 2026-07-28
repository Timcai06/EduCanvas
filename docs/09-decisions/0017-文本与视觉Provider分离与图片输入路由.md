# ADR-0017：文本与视觉 Provider 分离与图片输入路由

- 状态：`accepted`
- 日期：2026-07-28
- 负责人：@Timcai06

## 背景

EduCanvas 是多模态 K12 教学助手，拍照提问、看图解题是核心场景。Asset 侧的能力早已就位：`packages/asset-processing` 能物化图片、`buildAssetContext()` 会把 Provider 能原生消费的图片单独挑出来、OpenAI-compatible 协议层也已实现 `image` 片段到 `image_url` data URI 的投影（`openai-compatible-protocol.ts`）。

缺的是最后一环——**当前主 Provider 没有视觉能力**。开发期主 Provider 是 DeepSeek，其官方能力表只列出 Json Output、Tool Calls、Chat Prefix Completion、FIM Completion，没有任何图片输入项；实际传入 `image_url` 片段会整轮返回 `unknown variant image_url, expected text`。

现有实现对此的处理是诚实失败：`MODEL_GATEWAY_VISION` 默认 false，`nativeAssetKinds` 因而为空，`buildAssetContext()` 对既没有 `extractedText` 也不被原生支持的模态抛 `UnsupportedAgentInputModalityError`。这个行为是对的，但它把能力缺口固定了下来——只要主 Provider 是纯文本模型，图片输入就永远不可用。

同时需要澄清一个约束：`packages/asset-processing` 目前只有 audio/video/text-extraction/thumbnail，**没有 OCR 或图像描述**，所以「图片先转文本再喂给文本模型」这条退路当前也不通。

## 候选方案

**A. 更换主 Provider 为多模态模型**

把 DeepSeek 整体换成一个同时具备文本推理与视觉能力的供应商。

- 优点：只有一套凭据与一条链路，配置与审计最简单。
- 缺点：`config.ts`、`provider-parity.test.ts`、`env-check.mjs` 与 `.env` 示例都围绕 DeepSeek 的约束建成（hostname 白名单、staging/production 硬拒绝、固定关闭 thinking），整体替换牵动面远超「补上图片输入」这一个目标；且会为了一个低频模态放弃主模型在文本推理上的既有验证。

**B. 新增图像描述管线，图片先转文本**

在 `packages/asset-processing` 加 OCR/图像描述处理器，产出 `extractedText`，主 Provider 只消费文本。

- 优点：不动模型网关，`asset-context.ts` 已支持这条路径。
- 缺点：丢失像素级细节。判分型场景（看图选答案、指认图中元素、几何题）依赖模型直接看到原图，一段描述文本无法替代；而且它只是把「需要一个视觉模型」这件事挪到了另一个位置，并没有消除。

**C. 文本与视觉分属两个 Provider，按输入模态路由**

主 Provider 继续承担文本推理，另配一个专用视觉 Provider；只有本轮真的带了原生图片才切到后者。

- 优点：改动集中在配置解析与组合根，协议层零改动；两类模型各用自己真实擅长的能力；视觉供应商可独立替换而不影响教学主链路。
- 缺点：两套凭据与两条链路，配置面变大，审计需要能区分本轮用了哪个供应商。

## 决定

采用方案 **C**。

- 新增 `MODEL_GATEWAY_VISION_MODEL` / `_BASE_URL` / `_API_KEY` / `_TIMEOUT_MS` / `_MAX_OUTPUT_TOKENS` 一组配置，解析为 `EnabledModelGatewayConfiguration.visionProvider`；未配置模型即视觉 Provider 不存在。
- 保留原有 `MODEL_GATEWAY_VISION=true`（主 Provider 自带读图能力）语义，并与独立视觉 Provider **互斥**：同时声明抛 `VISION_PROVIDER_CONFLICT`。
- 新增 `acceptsImageInput(configuration)` 作为「本次部署能否接受图片」的唯一判据，物化层据此设置 `nativeAssetKinds`。
- 新增 `createVisionTurnModelGatewayFromEnvironment()` 构造独立的视觉 Gateway，与主 Gateway 是两个实例。
- 组合根 `general-turn.ts` 仅在 `assetContext.nativeImages.length > 0` 且视觉 Gateway 存在时才路由过去，否则一律走主 Gateway。

## 原因

**为什么按模态路由而不是无条件替换。** 视觉模型通常在纯文本推理、长上下文与工具调用上弱于同级文本模型。教学 Turn 绝大多数不含图片，无条件替换会让整条教学主链路陪着降级。只有真的带图那一轮才切换，代价被限制在确实需要视觉的场景里。

**为什么是两个 Gateway 实例而不是一个内部分支。** Adapter 持有 Base URL 与 API Key。把两套凭据塞进同一个实例，会让「这次请求发给了哪个供应商」在审计里变得不可判定——而 `ProviderCallMetadata` 与模型运行台账的价值正建立在这个判定之上。两个实例让供应商归属在构造期就是确定的。

**为什么所有 modelAlias 都投影到同一个视觉模型。** 视觉链路没有 primary/fast/structured 的档位区分。若只投影 `primary`，工具圈后的 `synthesis` 阶段按 `fast` 取模型会得到 undefined，整轮在第二次调用时静默失败。

**为什么视觉 Provider 固定 `provider: 'openai-compatible'`。** 它不是 DeepSeek，不能继承主配置里 DeepSeek 专属的请求形态（固定 `thinking: { type: "disabled" }`）。

**为什么半配置状态必须立即失败。** 配置了视觉模型却缺 Base URL 或 Key，如果只是静默降级，部署方会以为图片可用，直到学生真的传了一张图才在 Turn 中途失败。配置期失败比运行期失败便宜得多。

**为什么两种视觉来源互斥而不是定优先级。** 同时声明说明部署方对「图片走哪条链路」持有两种矛盾预期。替它猜一个，猜错的后果是图片被发往一个不支持的模型；直接拒绝把矛盾还给配置者。

## 后果

**收益**

- 图片输入在不更换主 Provider 的前提下可用，协议层与 Asset 物化层零改动。
- 视觉供应商可独立替换（改模型名与端点即可），不触碰教学主链路。
- 文本与视觉的超时、输出上限各自独立——读图任务图片 token 开销高但输出通常更短，两者的合理预算本就不一致。

**代价与风险**

- 配置面扩大：部署方需理解两组变量的关系。已由 `env-check.mjs` 的半配置检查与互斥检查兜底。
- 跨 Provider 的成本与配额目前仍未统一治理（与主 Provider 一样，属 `docs/03-ai/model-routing.md` 中「待实现」项）。
- 视觉链路固定走 native Adapter：AI SDK Adapter 的 provider 抽象目前只按主配置的 runtime 解析，尚未覆盖多 Provider 图片投影。`MODEL_GATEWAY_RUNTIME=ai-sdk` 的部署，其视觉请求仍走 native。

**后续工作**

- 视觉链路的 usage 与成本进入统一模型运行台账的聚合视图。
- AI SDK Adapter 覆盖视觉 Provider。
- 若后续引入 OCR/图像描述，它与视觉 Provider 是互补而非替代关系：前者服务扫描件 PDF 的文本层缺口（见 `text-extraction.ts`），后者服务需要像素细节的判分场景。

## 开放问题

- 视觉 Provider 的并发上限与教学高峰期的关系尚未实测；免费档模型通常有并发限制，需在真实课堂量级下验证。
- 一轮同时包含图片与工具调用时，视觉模型的工具调用可靠性未验证——当前 `MAX_NATIVE_IMAGES=4` 的预算下，工具圈行为需要单独的 live smoke 覆盖。

## 验证方式

- `packages/model-gateway/src/config-vision.test.ts`：解析、互斥、半配置失败、URL 安全校验、边界值。
- `packages/model-gateway/src/vision-turn-model-gateway.test.ts`：视觉请求发往视觉端点并使用视觉 Key、三个 alias 都解析到视觉模型、不携带 DeepSeek 专属字段、配额独立于主 Provider。
- `tooling/env-check.test.mjs`：半配置、互斥、Key 形状、staging/production HTTPS。
- 待补：使用真实凭据的手动 live smoke，验证图片输入的真实协议、质量与失败行为（Fixture 不能替代）。
