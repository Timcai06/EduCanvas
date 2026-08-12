import 'server-only';

import type {
  AgentTool,
  AgentToolContext,
  TurnApplicationProfileEvent,
} from '@educanvas/agent-runtime';
import {
  artifactProposalKindSchema,
  artifactProposalSchema,
} from '@educanvas/agent-core';
import {
  ARTIFACT_GENERATE_TASK,
  DrizzlePlatformArtifactRepository,
  type PlatformArtifact,
  type PlatformArtifactJob,
} from '@educanvas/db';
import { z } from 'zod';
import type { AnonymousIdentity } from '../identity/anonymous-identity';

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
    params: { generation: { instruction: string } };
  }): Promise<{ artifact: PlatformArtifact; job: PlatformArtifactJob }>;
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
      params: { generation: { instruction: toolInput.instruction } },
    });
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
