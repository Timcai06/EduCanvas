import 'server-only';

import { supportedGeneratedImageSizes } from '@educanvas/agent-core';
import type {
  AgentTool,
  AgentToolContext,
  TurnApplicationProfileEvent,
} from '@educanvas/agent-runtime';
import {
  ARTIFACT_GENERATE_TASK,
  DrizzlePlatformArtifactRepository,
  type PlatformArtifact,
  type PlatformArtifactJob,
} from '@educanvas/db';
import {
  parseModelGatewayConfiguration,
  resolveCapabilityGatewayConfiguration,
} from '@educanvas/model-gateway';
import { z } from 'zod';
import type { AnonymousIdentity } from '../identity/anonymous-identity';

/** 生成图像的 Artifact 类型；与 worker 分支和 Renderer 注册表共用同一字面量。 */
export const GENERATED_IMAGE_ARTIFACT_KIND = 'generated_image' as const;

/** 图像生成能力名；未出现在五维交集里时 ToolKernel 直接拒绝调用。 */
export const IMAGE_GENERATION_CAPABILITY = 'artifact.generate_image' as const;

/**
 * 模型可选的尺寸闭集来自 Port 白名单，避免工具层与适配器各持一份清单而漂移。
 * 提示词上限 2000 字符与 Worker 任务参数 Schema 一致。
 */
const generateCanvasImageInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(2_000),
    size: z.enum(supportedGeneratedImageSizes).default('1024x1024'),
  })
  .strict();

const generateCanvasImageOutputSchema = z
  .object({
    artifactId: z.uuid(),
    jobId: z.uuid(),
    kind: z.literal(GENERATED_IMAGE_ARTIFACT_KIND),
    title: z.string().trim().min(1).max(120),
    status: z.literal('proposed'),
  })
  .strict();

interface ImageArtifactRepository {
  createArtifactWithGenerationJob(input: {
    spaceId: string;
    conversationId: string;
    trustedSubjectId: string;
    operationId: string;
    kind: string;
    trustTier: 'tier2';
    title: string;
    taskIdentifier: typeof ARTIFACT_GENERATE_TASK;
    params: { image: { prompt: string; size: string } };
  }): Promise<{ artifact: PlatformArtifact; job: PlatformArtifactJob }>;
}

/**
 * 判断当前部署是否真的具备图像生成能力。
 *
 * 策略默认拒绝：只有同时满足「模型网关已启用」「图像能力可用」时，能力才会
 * 进入 ToolKernel 的可用集合，从而进入五维交集。少配任何一项都不注册工具——
 * 宁可模型看不到这个工具，也不要让它声称能画图后在 Worker 里以
 * `image_not_configured` 失败。
 *
 * 能力可用性统一由 `resolveCapabilityGatewayConfiguration()` 判定：继承主
 * Provider 或独立 override 均可；能力级配置错误只关闭该能力，不影响文本
 * Agent（ADR-0021）。
 *
 * 环境变量只在服务端读取，Key 不出 `packages/model-gateway`。
 */
export function isImageGenerationConfigured(): boolean {
  try {
    const primaryConfiguration = parseModelGatewayConfiguration({
      EDUCANVAS_DEPLOYMENT_ENV: process.env.EDUCANVAS_DEPLOYMENT_ENV,
      MODEL_GATEWAY_PROVIDER: process.env.MODEL_GATEWAY_PROVIDER,
      MODEL_GATEWAY_ALLOW_DEEPSEEK: process.env.MODEL_GATEWAY_ALLOW_DEEPSEEK,
      MODEL_GATEWAY_BASE_URL: process.env.MODEL_GATEWAY_BASE_URL,
      MODEL_GATEWAY_API_KEY: process.env.MODEL_GATEWAY_API_KEY,
      MODEL_GATEWAY_PRIMARY_MODEL: process.env.MODEL_GATEWAY_PRIMARY_MODEL,
      MODEL_GATEWAY_IMAGE_MODEL: process.env.MODEL_GATEWAY_IMAGE_MODEL,
      MODEL_GATEWAY_IMAGE_PROVIDER: process.env.MODEL_GATEWAY_IMAGE_PROVIDER,
      MODEL_GATEWAY_IMAGE_BASE_URL: process.env.MODEL_GATEWAY_IMAGE_BASE_URL,
      MODEL_GATEWAY_IMAGE_API_KEY: process.env.MODEL_GATEWAY_IMAGE_API_KEY,
    });
    return (
      resolveCapabilityGatewayConfiguration(
        {
          MODEL_GATEWAY_IMAGE_MODEL: process.env.MODEL_GATEWAY_IMAGE_MODEL,
          MODEL_GATEWAY_IMAGE_PROVIDER:
            process.env.MODEL_GATEWAY_IMAGE_PROVIDER,
          MODEL_GATEWAY_IMAGE_BASE_URL:
            process.env.MODEL_GATEWAY_IMAGE_BASE_URL,
          MODEL_GATEWAY_IMAGE_API_KEY: process.env.MODEL_GATEWAY_IMAGE_API_KEY,
          MODEL_GATEWAY_IMAGE_TIMEOUT_MS:
            process.env.MODEL_GATEWAY_IMAGE_TIMEOUT_MS,
        },
        'image',
        primaryConfiguration.enabled ? primaryConfiguration : null,
      ) !== null
    );
  } catch {
    /* 配置本身非法时同样不开放能力；配置错误码由既有 env:check 路径暴露。 */
    return false;
  }
}

/**
 * 单个 Operation 的图像产物边界。
 *
 * 与 `WebOperationArtifacts` 相同的信任纪律：身份、Notebook 与 Conversation 只
 * 从可信组合根注入，模型只能提供标题、提示词和闭集尺寸。工具本身不调用任何
 * 供应商，只创建 proposed 产物与耐久任务——真正的生成发生在 Worker，浏览器
 * 因此只会看到 accepted/job 状态，不会拿到同步的模型产物。
 *
 * 教育场景边界：本工具只用于生成课堂讲解需要的示意图、图示与配图。它与判分
 * 无关，产物固定为 tier2 且 `canProduceCandidateLearningEvents` 为 false，
 * 不进入任何可信学习事件路径（ADR-0004）。
 *
 * 风险等级 l1：副作用被本 Notebook 完全包住——新增一个 proposed 产物与一条
 * 队列任务，用户可归档、可忽略，且不产生对外分发。若将来支持把生成图像推送
 * 到 Notebook 之外（公开分享、外部投递），必须先升级为 l2 并接上审批与
 * continuation 恢复，不能沿用本级别。
 */
export class WebOperationImageArtifacts {
  private readonly proposed = new Map<string, TurnApplicationProfileEvent>();

  constructor(
    private readonly input: {
      identity: AnonymousIdentity;
      conversationId: string;
      spaceId: string;
      operationId: string;
    },
    private readonly repository: ImageArtifactRepository = new DrizzlePlatformArtifactRepository(),
  ) {}

  createTool(): AgentTool<
    z.input<typeof generateCanvasImageInputSchema>,
    z.infer<typeof generateCanvasImageOutputSchema>
  > {
    return {
      name: 'generateCanvasImage',
      description:
        '在当前 Notebook 的 Canvas 中生成一张教学配图。仅当用户明确要求画图、示意图或插图时调用；prompt 必须完整描述画面内容，不能只重复标题。返回 proposed 表示后台已开始生成，不代表图片已经完成，也不代表你已经看过这张图。',
      inputSchema: generateCanvasImageInputSchema,
      outputSchema: generateCanvasImageOutputSchema,
      timeoutMs: 15_000,
      handler: async (toolInput, context) =>
        this.generateImage(
          generateCanvasImageInputSchema.parse(toolInput),
          context,
        ),
    };
  }

  events(): readonly TurnApplicationProfileEvent[] {
    return [...this.proposed.values()];
  }

  private async generateImage(
    toolInput: z.infer<typeof generateCanvasImageInputSchema>,
    context: AgentToolContext,
  ): Promise<z.infer<typeof generateCanvasImageOutputSchema>> {
    if (
      context.subjectId !== this.input.identity.studentId ||
      context.conversationId !== this.input.conversationId
    ) {
      throw new Error('canvas_image_scope_mismatch');
    }
    const created = await this.repository.createArtifactWithGenerationJob({
      spaceId: this.input.spaceId,
      conversationId: this.input.conversationId,
      trustedSubjectId: this.input.identity.studentId,
      operationId: this.input.operationId,
      kind: GENERATED_IMAGE_ARTIFACT_KIND,
      /* 生成位图不是判分型白名单内容，固定 tier2；tier1 保留给可判分产物。 */
      trustTier: 'tier2',
      title: toolInput.title,
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      params: { image: { prompt: toolInput.prompt, size: toolInput.size } },
    });
    this.proposed.set(created.artifact.id, {
      protocol: 'educanvas.turn.v2',
      operationId: this.input.operationId,
      type: 'artifact.proposed',
      artifactId: created.artifact.id,
      artifactKind: GENERATED_IMAGE_ARTIFACT_KIND,
      trustTier: 'tier2',
      title: created.artifact.title,
    });
    return {
      artifactId: created.artifact.id,
      jobId: created.job.id,
      kind: GENERATED_IMAGE_ARTIFACT_KIND,
      title: created.artifact.title,
      status: 'proposed',
    };
  }
}
