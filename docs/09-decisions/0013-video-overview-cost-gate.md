# ADR-0013：M5 视频概览成本闸门与顺延

- 状态：`accepted`
- 日期：2026-07-18
- 负责人：项目负责人
- 关联：[ADR-0012](0012-artifact-runtime-durable-jobs.md)（持久任务与对象存储）、[产品复刻计划](../plan/active/2026-07-gemini-notebooklm-replica.md)

## 背景

M5 不是当前计划的必交付项，而是“先评估 Provider 与成本，闸门通过才开工”的里程碑。目标体验参考 Gemini Notebook 的 Video Overview，而不是生成一段与来源弱相关的电影片段。其官方说明把 Short 定义为约 60 秒，并明确提示视频可能包含事实或音频错误、后台生成有时超过 30 分钟；Cinematic 与 Short 还只支持英语且限 18 岁以上。因此 K12 产品需要优先保证来源忠实、中文可用与可预测成本，不能直接照搬面向成人的生成式视频形态。

当前仓库已有可恢复 Artifact Job、私有对象存储、Range 媒体读取和 M4 TTS，但没有视频 Provider Port、跨供应商长任务状态机、镜头拼接器或 FFmpeg/Remotion 渲染运行时。项目也尚未实现跨用户日预算、月度熔断和正式账号配额。此时把按秒计费的视频模型暴露为学生默认的一键产物，会先形成不可控成本与来源失真面。

产品基准：[Gemini Notebook Video Overview](https://support.google.com/notebooklm/answer/16454555?hl=en)。价格与能力均按 2026-07-18 官方公开资料核对，重新开闸前必须复核。

## 候选方案与成本

统一以 60 秒、720p、单个可交付视频估算。`+25%` 是“输出不适用而重新生成”的产品预算余量，不代表 Provider 对技术失败一定收费。下表还没有计入脚本模型、图片生成、TTS、拼接、存储和流量成本。

| 方案                                | 官方单价 | 60 秒名义成本 | 含 25% 余量 | 关键限制                                                     |
| ----------------------------------- | -------: | ------------: | ----------: | ------------------------------------------------------------ |
| Vertex AI Veo 3.1 Lite，无音频 720p | $0.03/秒 |         $1.80 |       $2.25 | Preview；4/6/8 秒片段；英语 Prompt；固定配额，不支持按量付费 |
| Vertex AI Veo 3.1 Fast，无音频 720p | $0.08/秒 |         $4.80 |       $6.00 | 4/6/8 秒片段；需要多镜头拼接                                 |
| Runway Gen-4 Turbo                  | $0.05/秒 |         $3.00 |       $3.75 | 需要图片输入；输出 URL 24–48 小时过期                        |
| Runway Gen-4.5                      | $0.12/秒 |         $7.20 |       $9.00 | 文本/图片转视频；异步轮询；仍需拼接与配音                    |
| OpenAI Sora 2，720p                 | $0.10/秒 |         $6.00 |       $7.50 | 官方目录已标为 Legacy，快照已 Deprecated                     |
| OpenAI Sora 2 Pro，720p             | $0.30/秒 |        $18.00 |      $22.50 | 官方目录已标为 Legacy，快照已 Deprecated                     |

官方依据：

- [Google Veo 定价](https://cloud.google.com/vertex-ai/generative-ai/pricing#veo)与[Veo 3.1 能力](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate)：Lite/Fast 的价格、4/6/8 秒长度、英语 Prompt、配额和发布阶段；
- [Runway 定价](https://docs.dev.runwayml.com/guides/pricing/)、[异步任务](https://docs.dev.runwayml.com/api-details/sdks/)与[临时输出](https://docs.dev.runwayml.com/assets/outputs/)：credit 为 $0.01、按秒费率、轮询终态和 24–48 小时输出地址；
- [OpenAI Sora 2](https://developers.openai.com/api/docs/models/sora-2)、[Sora 2 Pro](https://developers.openai.com/api/docs/models/sora-2-pro)与[Video API](https://developers.openai.com/api/docs/guides/video-generation)：按秒费率、Legacy/Deprecated 状态和异步任务形态。

即使采用最低的 Veo 3.1 Lite，无重生成时 100 个 60 秒视频也约为 `$180/日`；按 25% 可用输出余量则约 `$225/日`。这还不是完整交付成本，并且该最低价档当前不提供按量付费。

另一候选是**确定性 Explainer 渲染**：来源约束的镜头脚本 → 已有 Slides/图表组件 → M4 配音 → 服务端渲染 MP4。它把事实放在受 Schema 约束的文字与图形层，视频模型只可选地生成 1–2 个装饰镜头。变量成本预计显著低于全程生成式视频，但需要单独评估渲染运行时、字体/编码、部署镜像和任务超时，不应塞进当前计划收尾。

## 决定

1. **M5 外部生成式视频闸门不通过，顺延为独立计划。** 当前计划不新增 `video.generate`、视频模型 alias、Provider Secret、数据库迁移或学生端生成入口；通用 `artifact kind=video` 只是预留契约，不代表已交付能力。
2. 当前开发主线转入 UI 蓝图 PR-U3；M1–M4 的完成状态不因 M5 顺延而受阻。
3. 下一次评估默认优先“确定性 Explainer/混合渲染”，而不是用视频模型承载事实。外部生成镜头只能作为可删除的装饰层，不能成为结论、数字、公式或引用的唯一载体。
4. 重新开闸前必须同时满足：
   - 项目负责人明确单任务、每日与月度美元预算；调用前原子预留预算，具备全局 kill switch；
   - 60 秒 720p 的来源脚本、字幕和画面文字都能追溯到冻结的 AssetVersion；
   - Provider Job ID、预计成本、实际计费秒数、模型版本和终态进入 checkpoint/审计；不得隐藏重试，用户显式重试必须创建新任务；
   - Provider 临时输出在过期前校验并复制到 EduCanvas 自有对象存储；浏览器不接收 Provider URL；
   - 只向视频 Provider 发送派生镜头 Prompt/必要视觉资产，不发送完整原始资料；完成 K12 内容安全、中文输出和年龄边界评估；
   - CI 使用零费用 Fixture，live smoke 只能由人工显式触发并受固定美元上限保护。

## 原因

- 参考产品的核心价值是“把来源解释清楚”，不是每秒都由生成模型合成；确定性文字、图表和字幕更适合 K12 的事实边界。
- 当前最低候选仍有显著的逐任务变量成本、Preview/固定配额限制和多片段拼接复杂度；高质量候选成本高一个数量级。
- 当前没有跨用户预算与月度熔断。在成本治理完成前新增入口，会违反 ADR-0012 已采用的“显式上限、诚实失败、无静默重试”纪律。
- OpenAI 候选已进入 Legacy/Deprecated；把新 Port 绑定在退场模型上会立即产生迁移债务。

## 后果

- 本阶段不会出现视频概览入口，也不会产生视频 Provider 费用；README 与计划必须明确“已评估并顺延”，不能继续显示成即将开工。
- 通用视频 Asset/Artifact 契约继续保留，未来确定性渲染或新 Provider 可以复用现有对象存储、版本和 Range 读取边界。
- 后续独立计划需要先交付成本账本/配额与渲染技术 Spike，再决定是否引入 Provider Adapter。
- 产品开发资源转向 PR-U3、U4、U5，先完成统一输入与 Canvas 共创体验。

## 验证方式

- 每次重新评估从官方价格、模型状态、长度/语言/配额限制重新计算 60 秒与 100 次/日成本，不复用本 ADR 的旧数字；
- 新的视频实现 PR 必须引用一份取代本决定的新 ADR，并用测试证明预算预留、无隐式重试、临时输出归档和来源追溯；
- 当前仓库验证以文档链接、Markdown 格式检查和“无视频 Provider 代码/配置变更”为准。
