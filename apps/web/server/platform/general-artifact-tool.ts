import 'server-only';

import type {
  AgentTool,
  AgentToolContext,
  TurnApplicationProfileEvent,
} from '@educanvas/agent-runtime';
import {
  artifactProposalKindSchema,
  artifactProposalSchema,
  type ArtifactProposalKind,
  type AssetVersionReference,
  type AssetVersionRepresentationIdentity,
} from '@educanvas/agent-core';
import {
  ARTIFACT_GENERATE_TASK,
  DrizzlePlatformArtifactRepository,
  type PlatformArtifact,
  type PlatformArtifactGenerationReceipt,
  type PlatformArtifactJob,
} from '@educanvas/db';
import { DrizzleArtifactConfirmationRepository } from '@educanvas/db';
import { z } from 'zod';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import {
  getCanvasArtifactStatusInputSchema,
  getCanvasArtifactStatusOutputSchema,
  toCanvasArtifactStatusOutput,
} from './general-artifact-status';
import {
  generalTurnArtifactIdempotency,
  type GeneralTurnArtifactSemanticRequest,
} from './operation-artifact-idempotency';

type CreateCanvasArtifactInput = z.infer<typeof artifactProposalSchema>;

export const createCanvasArtifactOutputSchema = z
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

interface ArtifactStatusRepository {
  getGenerationReceipt(input: {
    artifactId: string;
    spaceId: string;
    conversationId: string;
    trustedSubjectId: string;
  }): Promise<PlatformArtifactGenerationReceipt | null>;
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
  private confirmationProposal: {
    kind: z.infer<typeof artifactProposalKindSchema>;
    title: string;
  } | null = null;

  constructor(
    private readonly input: {
      identity: AnonymousIdentity;
      conversationId: string;
      spaceId: string;
      operationId: string;
      confirmedArtifactKind?: ArtifactProposalKind;
      /**
       * 只能由已物化的服务端 Asset plan 注入。模型和浏览器都不能声明 Artifact
       * provenance；所有输入段在 General Profile 中是 required，因此这里与随后
       * 写入的 Turn Context Snapshot 使用同一组不可变版本事实。
       */
      sourceReferences?: readonly ArtifactInputSourceReference[];
    },
    private readonly repository: ArtifactGenerationRepository = new DrizzlePlatformArtifactRepository(),
    private readonly statusRepository: ArtifactStatusRepository = new DrizzlePlatformArtifactRepository(),
  ) {}

  createTool(): AgentTool<
    CreateCanvasArtifactInput,
    z.infer<typeof createCanvasArtifactOutputSchema>
  > {
    const inputSchema = this.input.confirmedArtifactKind
      ? artifactProposalSchema.extend({
          kind: z.literal(this.input.confirmedArtifactKind),
        })
      : artifactProposalSchema;
    return {
      name: 'createCanvasArtifact',
      description:
        '在当前 Notebook 的 Canvas 中提议持久产物。只选择契约闭集中的 Markdown 文档、思维导图、Slides、闪卡、低龄知识绘本、笔记或 Web App；instruction 必须概括用户要求；返回 proposed 只表示服务端已原子创建任务，不代表已完成。',
      inputSchema,
      outputSchema: createCanvasArtifactOutputSchema,
      timeoutMs: 15_000,
      handler: async (toolInput, context) =>
        this.createArtifact(toolInput, context),
    };
  }

  getStatusTool(): AgentTool<
    z.infer<typeof getCanvasArtifactStatusInputSchema>,
    z.infer<typeof getCanvasArtifactStatusOutputSchema>
  > {
    return {
      name: 'getCanvasArtifactStatus',
      description:
        '只读查询当前 Notebook 与会话中单个产物的最新生成任务。传入历史产物状态里的 artifactId；proposed 表示已提交排队，running 表示正在生成。只有最新任务为 succeeded 且该 job 对应的不可变产物版本已落库，才会返回 succeeded。缺失或不属于当前用户、Notebook、会话的产物都返回 not_found；不返回生成参数或错误细节。每次调用只读取一次当前服务端状态，不会等待或自动轮询。',
      inputSchema: getCanvasArtifactStatusInputSchema,
      outputSchema: getCanvasArtifactStatusOutputSchema,
      timeoutMs: 5_000,
      handler: async (toolInput, context) => {
        if (
          context.subjectId !== this.input.identity.studentId ||
          context.conversationId !== this.input.conversationId
        ) {
          throw new Error('canvas_artifact_scope_mismatch');
        }
        const receipt = await this.statusRepository.getGenerationReceipt({
          artifactId: toolInput.artifactId,
          spaceId: this.input.spaceId,
          conversationId: this.input.conversationId,
          trustedSubjectId: this.input.identity.studentId,
        });
        return toCanvasArtifactStatusOutput(toolInput.artifactId, receipt);
      },
    };
  }

  /** Model-only semantic proposal. It keeps only a bounded candidate in memory;
   * durable state is written later by finalize, after the whole Turn succeeds. */
  requestConfirmationTool(): AgentTool<
    { kind: z.infer<typeof artifactProposalKindSchema>; title: string },
    {
      kind: z.infer<typeof artifactProposalKindSchema>;
      title: string;
      status: 'awaiting_confirmation';
    }
  > {
    const inputSchema = z
      .object({
        kind: artifactProposalKindSchema,
        title: z.string().trim().min(1).max(120),
      })
      .strict();
    const outputSchema = z
      .object({
        kind: artifactProposalKindSchema,
        title: z.string().trim().min(1).max(120),
        status: z.literal('awaiting_confirmation'),
      })
      .strict();
    return {
      name: 'proposeCanvasArtifact',
      description:
        '为用户明确要求的持久 Canvas 产物提出一个建议类型和标题；此工具不会创建 Artifact、Generation Job 或后台任务。普通聊天、解释、摘要、草稿和没有明确持久化要求的请求不要调用。',
      inputSchema,
      outputSchema,
      timeoutMs: 2_000,
      handler: async (input, context) => {
        if (
          context.subjectId !== this.input.identity.studentId ||
          context.conversationId !== this.input.conversationId
        )
          throw new Error('canvas_artifact_scope_mismatch');
        this.confirmationProposal = { kind: input.kind, title: input.title };
        return {
          ...this.confirmationProposal,
          status: 'awaiting_confirmation',
        };
      },
    };
  }

  async finalizeConfirmation(input: {
    userMessageId: string;
    actorUserId: string;
  }): Promise<TurnApplicationProfileEvent | null> {
    const proposal = this.confirmationProposal;
    if (!proposal) return null;
    const pending =
      await new DrizzleArtifactConfirmationRepository().createPending({
        operationId: this.input.operationId,
        userMessageId: input.userMessageId,
        actorUserId: input.actorUserId,
        notebookId: this.input.spaceId,
        conversationId: this.input.conversationId,
        artifactKind: proposal.kind,
        title: proposal.title,
      });
    return {
      protocol: 'educanvas.turn.v2',
      operationId: this.input.operationId,
      type: 'artifact.confirmation_required',
      confirmationId: pending.id,
      artifactKind: pending.artifactKind,
      title: pending.title,
    };
  }

  confirmationProposalSnapshot() {
    return this.confirmationProposal ? { ...this.confirmationProposal } : null;
  }

  events(): readonly TurnApplicationProfileEvent[] {
    return [...this.proposed.values()];
  }

  private async createArtifact(
    toolInput: CreateCanvasArtifactInput,
    context: AgentToolContext,
  ): Promise<z.infer<typeof createCanvasArtifactOutputSchema>> {
    if (
      context.subjectId !== this.input.identity.studentId ||
      context.conversationId !== this.input.conversationId
    ) {
      throw new Error('canvas_artifact_scope_mismatch');
    }
    if (
      this.input.confirmedArtifactKind &&
      toolInput.kind !== this.input.confirmedArtifactKind
    ) {
      throw new Error('artifact_confirmation_kind_mismatch');
    }
    const created = await this.repository.createArtifactWithGenerationJob({
      spaceId: this.input.spaceId,
      conversationId: this.input.conversationId,
      trustedSubjectId: this.input.identity.studentId,
      operationId: this.input.operationId,
      kind: toolInput.kind,
      trustTier:
        toolInput.kind === 'web_app' || toolInput.kind === 'picturebook'
          ? 'tier2'
          : 'tier1',
      title: toolInput.title,
      taskIdentifier: ARTIFACT_GENERATE_TASK,
      ...generalTurnArtifactIdempotency(this.input.operationId, {
        kind: toolInput.kind,
        title: toolInput.title,
        instruction: toolInput.instruction,
        provenance: {
          sources: [...(this.input.sourceReferences ?? [])],
        },
      } satisfies GeneralTurnArtifactSemanticRequest),
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
      trustTier:
        toolInput.kind === 'web_app' || toolInput.kind === 'picturebook'
          ? 'tier2'
          : 'tier1',
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
