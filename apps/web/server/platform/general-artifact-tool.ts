import 'server-only';

import type {
  AgentTool,
  AgentToolContext,
  TurnApplicationProfileEvent,
} from '@educanvas/agent-runtime';
import {
  artifactProposalKindSchema,
  artifactProposalSchema,
  type AssetVersionReference,
  type AssetVersionRepresentationIdentity,
} from '@educanvas/agent-core';
import {
  ARTIFACT_GENERATE_TASK,
  DrizzlePlatformArtifactRepository,
  type PlatformArtifact,
  type PlatformArtifactJob,
} from '@educanvas/db';
import { z } from 'zod';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { generalTurnArtifactIdempotency } from './operation-artifact-idempotency';

const createCanvasArtifactInputSchema = artifactProposalSchema;

const createCanvasArtifactOutputSchema = z
  .object({
    artifactId: z.uuid(),
    jobId: z.uuid(),
    kind: artifactProposalKindSchema,
    title: z.string().trim().min(1).max(120),
    status: z.literal('proposed'),
  })
  .strict();

interface ArtifactGenerationRepository {
  createArtifactWithGenerationJob(input: {
    spaceId: string;
    conversationId: string;
    trustedSubjectId: string;
    operationId: string;
    kind: string;
    trustTier: 'tier1' | 'tier2';
    title: string;
    taskIdentifier: typeof ARTIFACT_GENERATE_TASK;
    idempotencyKey: string;
    requestFingerprint: string;
    params: {
      generation: { instruction: string };
      provenance: {
        sources: readonly ArtifactInputSourceReference[];
      };
    };
  }): Promise<{
    artifact: PlatformArtifact;
    job: PlatformArtifactJob;
    replayed?: boolean;
  }>;
}

export interface ArtifactInputSourceReference {
  readonly assetId: string;
  readonly versionId: string;
  /** 本轮实际进入模型的表示身份；原生图片或旧资产为 null。 */
  readonly representation: AssetVersionRepresentationIdentity | null;
}

/**
 * 把本轮已物化的文本段和原生输入收敛成 Artifact provenance。
 * 同一不可变版本可能同时贡献 Markdown 与派生图片，必须只冻结一次且保持首见顺序。
 */
export function collectArtifactInputSourceReferences(input: {
  readonly textSegments: readonly {
    readonly reference: AssetVersionReference;
    readonly representation: AssetVersionRepresentationIdentity | null;
  }[];
  readonly nativeReferences: readonly AssetVersionReference[];
}): readonly ArtifactInputSourceReference[] {
  const references: ArtifactInputSourceReference[] = [];
  const seen = new Set<string>();
  const append = (reference: ArtifactInputSourceReference) => {
    const key = `${reference.assetId}:${reference.versionId}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push(reference);
  };
  for (const segment of input.textSegments) {
    append({
      assetId: segment.reference.assetId,
      versionId: segment.reference.versionId,
      representation: segment.representation,
    });
  }
  for (const reference of input.nativeReferences) {
    append({
      assetId: reference.assetId,
      versionId: reference.versionId,
      representation: null,
    });
  }
  return references;
}

/**
 * 单个 Operation 的 Canvas 产物边界。
 *
 * 身份、Notebook 与 Conversation 只从可信组合根注入；模型只能选择受限的产物
 * 类型和标题。仓储负责再次校验所有权，并把 Artifact、Generation Job 与队列
 * 消息原子提交，模型不能直接写 Canvas 内容或伪造“生成完成”。
 */
export class WebOperationArtifacts {
  private readonly proposed = new Map<string, TurnApplicationProfileEvent>();

  constructor(
    private readonly input: {
      identity: AnonymousIdentity;
      conversationId: string;
      spaceId: string;
      operationId: string;
      /**
       * 只能由已物化的服务端 Asset plan 注入。模型和浏览器都不能声明 Artifact
       * provenance；所有输入段在 General Profile 中是 required，因此这里与随后
       * 写入的 Turn Context Snapshot 使用同一组不可变版本事实。
       */
      sourceReferences?: readonly ArtifactInputSourceReference[];
    },
    private readonly repository: ArtifactGenerationRepository = new DrizzlePlatformArtifactRepository(),
  ) {}

  createTool(): AgentTool<
    z.infer<typeof createCanvasArtifactInputSchema>,
    z.infer<typeof createCanvasArtifactOutputSchema>
  > {
    return {
      name: 'createCanvasArtifact',
      description:
        '在当前 Notebook 的 Canvas 中提议持久产物。只选择契约闭集中的 Markdown 文档、思维导图、Slides、闪卡、笔记或 Web App；instruction 必须概括用户要求；返回 proposed 只表示服务端已原子创建任务，不代表已完成。',
      inputSchema: createCanvasArtifactInputSchema,
      outputSchema: createCanvasArtifactOutputSchema,
      timeoutMs: 15_000,
      handler: async (toolInput, context) =>
        this.createArtifact(toolInput, context),
    };
  }

  events(): readonly TurnApplicationProfileEvent[] {
    return [...this.proposed.values()];
  }

  private async createArtifact(
    toolInput: z.infer<typeof createCanvasArtifactInputSchema>,
    context: AgentToolContext,
  ): Promise<z.infer<typeof createCanvasArtifactOutputSchema>> {
    if (
      context.subjectId !== this.input.identity.studentId ||
      context.conversationId !== this.input.conversationId
    ) {
      throw new Error('canvas_artifact_scope_mismatch');
    }
    const created = await this.repository.createArtifactWithGenerationJob({
      spaceId: this.input.spaceId,
      conversationId: this.input.conversationId,
      trustedSubjectId: this.input.identity.studentId,
      operationId: this.input.operationId,
      kind: toolInput.kind,
      trustTier: toolInput.kind === 'web_app' ? 'tier2' : 'tier1',
      title: toolInput.title,
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      ...generalTurnArtifactIdempotency(this.input.operationId),
      params: {
        generation: { instruction: toolInput.instruction },
        provenance: {
          sources: [...(this.input.sourceReferences ?? [])],
        },
      },
    });
    if (created.artifact.kind !== toolInput.kind) {
      throw new Error('artifact_already_proposed_for_turn');
    }
    this.proposed.set(created.artifact.id, {
      protocol: 'educanvas.turn.v2',
      operationId: this.input.operationId,
      type: 'artifact.proposed',
      artifactId: created.artifact.id,
      artifactKind: toolInput.kind,
      trustTier: toolInput.kind === 'web_app' ? 'tier2' : 'tier1',
      title: created.artifact.title,
    });
    return {
      artifactId: created.artifact.id,
      jobId: created.job.id,
      kind: toolInput.kind,
      title: created.artifact.title,
      status: 'proposed',
    };
  }
}
