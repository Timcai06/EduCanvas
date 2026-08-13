import type { AgentToolContext } from '@educanvas/agent-runtime';
import type { PlatformArtifact, PlatformArtifactJob } from '@educanvas/db';
import { describe, expect, it, vi } from 'vitest';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import {
  collectArtifactInputSourceReferences,
  WebOperationArtifacts,
} from './general-artifact-tool';

vi.mock('server-only', () => ({}));

const identity: AnonymousIdentity = {
  token: 'test-token',
  studentId: 'student-1',
};
const context: AgentToolContext = {
  traceId: 'trace-1',
  turnId: 'turn-1',
  subjectId: identity.studentId,
  conversationId: 'conversation-1',
};
const artifact: PlatformArtifact = {
  id: '10331832-85cc-4ed4-b85a-32ac829e4599',
  spaceId: 'space-1',
  conversationId: context.conversationId,
  ownerSubjectId: identity.studentId,
  kind: 'mind_map',
  trustTier: 'tier1',
  title: '分数思维导图',
  status: 'proposed',
  latestVersion: 0,
  createdAt: '2026-07-25T00:00:00.000Z',
  updatedAt: '2026-07-25T00:00:00.000Z',
};
const job: PlatformArtifactJob = {
  id: '2bd08cb5-5a36-444f-b76f-f31cbd44eef9',
  artifactId: artifact.id,
  operationId: 'operation-1',
  status: 'queued',
  progress: null,
  failureCode: null,
  params: {},
  checkpoint: {},
  queueJobKey: `artifact-generate:${artifact.id}`,
};

describe('WebOperationArtifacts', () => {
  it('拒绝把同一 Turn 已有的其他类型 Artifact 伪装成新提议', async () => {
    const repository = {
      createArtifactWithGenerationJob: vi.fn().mockResolvedValue({
        artifact: { ...artifact, kind: 'generated_image' },
        job,
        replayed: true,
      }),
    };
    const operationArtifacts = new WebOperationArtifacts(
      {
        identity,
        conversationId: context.conversationId,
        spaceId: artifact.spaceId,
        operationId: 'operation-1',
      },
      repository,
    );

    await expect(
      operationArtifacts.createTool().handler(
        {
          kind: 'mind_map',
          title: '思维导图',
          instruction: '整理课程内容。',
        },
        context,
      ),
    ).rejects.toThrow('artifact_already_proposed_for_turn');
    expect(operationArtifacts.events()).toEqual([]);
  });

  it('从实际物化计划按首见顺序冻结文本与原生版本并去重', () => {
    expect(
      collectArtifactInputSourceReferences({
        textSegments: [
          {
            reference: {
              assetId: 'asset-document',
              versionId: 'version-document',
              kind: 'document',
            },
            representation: {
              kind: 'text',
              quality: 'structured',
              variant: 'default',
              producer: 'mineru',
              producerVersion: 'v1',
            },
          },
        ],
        nativeReferences: [
          {
            assetId: 'asset-document',
            versionId: 'version-document',
            kind: 'document',
          },
          {
            assetId: 'asset-image',
            versionId: 'version-image',
            kind: 'image',
          },
        ],
      }),
    ).toEqual([
      {
        assetId: 'asset-document',
        versionId: 'version-document',
        representation: {
          kind: 'text',
          quality: 'structured',
          variant: 'default',
          producer: 'mineru',
          producerVersion: 'v1',
        },
      },
      {
        assetId: 'asset-image',
        versionId: 'version-image',
        representation: null,
      },
    ]);
  });

  it('以可信 Notebook 范围原子入队并投影 proposed 事件', async () => {
    const repository = {
      createArtifactWithGenerationJob: vi
        .fn()
        .mockResolvedValue({ artifact, job }),
    };
    const operationArtifacts = new WebOperationArtifacts(
      {
        identity,
        conversationId: context.conversationId,
        spaceId: artifact.spaceId,
        operationId: 'operation-1',
        sourceReferences: [
          {
            assetId: 'asset-1',
            versionId: 'asset-version-1',
            representation: {
              kind: 'text',
              quality: 'structured',
              variant: 'default',
              producer: 'mineru',
              producerVersion: 'v1',
            },
          },
        ],
      },
      repository,
    );

    const output = await operationArtifacts.createTool().handler(
      {
        kind: 'mind_map',
        title: artifact.title,
        instruction: '围绕分数的意义、运算规则和常见错误整理。',
      },
      context,
    );

    expect(repository.createArtifactWithGenerationJob).toHaveBeenCalledWith({
      spaceId: artifact.spaceId,
      conversationId: context.conversationId,
      trustedSubjectId: identity.studentId,
      operationId: 'operation-1',
      kind: 'mind_map',
      trustTier: 'tier1',
      title: artifact.title,
      taskIdentifier: 'artifact:generate',
      idempotencyKey: 'general-turn-artifact:operation-1',
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      params: {
        generation: {
          instruction: '围绕分数的意义、运算规则和常见错误整理。',
        },
        provenance: {
          sources: [
            {
              assetId: 'asset-1',
              versionId: 'asset-version-1',
              representation: {
                kind: 'text',
                quality: 'structured',
                variant: 'default',
                producer: 'mineru',
                producerVersion: 'v1',
              },
            },
          ],
        },
      },
    });
    expect(output).toEqual({
      artifactId: artifact.id,
      jobId: job.id,
      kind: 'mind_map',
      title: artifact.title,
      status: 'proposed',
    });
    expect(operationArtifacts.events()).toEqual([
      {
        protocol: 'educanvas.turn.v2',
        operationId: 'operation-1',
        type: 'artifact.proposed',
        artifactId: artifact.id,
        artifactKind: 'mind_map',
        trustTier: 'tier1',
        title: artifact.title,
      },
    ]);
  });

  it('拒绝 Tool Kernel 注入范围与组合根不一致', async () => {
    const repository = {
      createArtifactWithGenerationJob: vi.fn(),
    };
    const operationArtifacts = new WebOperationArtifacts(
      {
        identity,
        conversationId: context.conversationId,
        spaceId: artifact.spaceId,
        operationId: 'operation-1',
      },
      repository,
    );

    await expect(
      operationArtifacts.createTool().handler(
        {
          kind: 'slides',
          title: '课堂小结',
          instruction: '总结本轮课堂内容。',
        },
        { ...context, subjectId: 'student-2' },
      ),
    ).rejects.toThrow('canvas_artifact_scope_mismatch');
    expect(repository.createArtifactWithGenerationJob).not.toHaveBeenCalled();
  });

  it('允许提交 markdown_document 并归一化为 tier1', async () => {
    const repository = {
      createArtifactWithGenerationJob: vi.fn().mockResolvedValue({
        artifact: { ...artifact, kind: 'markdown_document' },
        job: { ...job, artifactId: artifact.id },
      }),
    };
    const operationArtifacts = new WebOperationArtifacts(
      {
        identity,
        conversationId: context.conversationId,
        spaceId: artifact.spaceId,
        operationId: 'operation-1',
      },
      repository,
    );

    const output = await operationArtifacts.createTool().handler(
      {
        kind: 'markdown_document',
        title: '课程文档',
        instruction: '生成一份课程结构化文档。',
      },
      context,
    );

    expect(repository.createArtifactWithGenerationJob).toHaveBeenCalledWith({
      spaceId: artifact.spaceId,
      conversationId: context.conversationId,
      trustedSubjectId: identity.studentId,
      operationId: 'operation-1',
      kind: 'markdown_document',
      trustTier: 'tier1',
      title: '课程文档',
      taskIdentifier: 'artifact:generate',
      idempotencyKey: 'general-turn-artifact:operation-1',
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      params: {
        generation: {
          instruction: '生成一份课程结构化文档。',
        },
        provenance: { sources: [] },
      },
    });
    expect(output).toEqual({
      artifactId: artifact.id,
      jobId: job.id,
      kind: 'markdown_document',
      title: artifact.title,
      status: 'proposed',
    });
  });

  it('允许提交 web_app 并将 trustTier 设为 tier2', async () => {
    const repository = {
      createArtifactWithGenerationJob: vi.fn().mockResolvedValue({
        artifact: { ...artifact, kind: 'web_app', trustTier: 'tier2' },
        job: { ...job, artifactId: artifact.id },
      }),
    };
    const operationArtifacts = new WebOperationArtifacts(
      {
        identity,
        conversationId: context.conversationId,
        spaceId: artifact.spaceId,
        operationId: 'operation-1',
      },
      repository,
    );

    const output = await operationArtifacts.createTool().handler(
      {
        kind: 'web_app',
        title: '课程网页',
        instruction: '基于对话生成一页课程网站。',
      },
      context,
    );

    expect(repository.createArtifactWithGenerationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: artifact.spaceId,
        conversationId: context.conversationId,
        trustedSubjectId: identity.studentId,
        operationId: 'operation-1',
        kind: 'web_app',
        trustTier: 'tier2',
        title: '课程网页',
        taskIdentifier: 'artifact:generate',
        idempotencyKey: 'general-turn-artifact:operation-1',
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        params: {
          generation: {
            instruction: '基于对话生成一页课程网站。',
          },
          provenance: { sources: [] },
        },
      }),
    );
    expect(output).toMatchObject({
      artifactId: artifact.id,
      jobId: job.id,
      kind: 'web_app',
      title: artifact.title,
      status: 'proposed',
    });
  });

  it('同一 Turn 的精确请求稳定重试，语义字段变化保持同键但产生不同指纹', async () => {
    const createArtifactWithGenerationJob = vi
      .fn()
      .mockResolvedValue({ artifact, job });
    const operationArtifacts = new WebOperationArtifacts(
      {
        identity,
        conversationId: context.conversationId,
        spaceId: artifact.spaceId,
        operationId: 'operation-1',
        sourceReferences: [
          { assetId: 'asset-1', versionId: 'version-1', representation: null },
        ],
      },
      { createArtifactWithGenerationJob },
    );
    const tool = operationArtifacts.createTool();
    const exactRequest = {
      kind: 'mind_map' as const,
      title: '分数思维导图',
      instruction: '整理课程内容。',
    };

    await tool.handler(exactRequest, context);
    await tool.handler({ ...exactRequest }, context);
    await tool.handler(
      { ...exactRequest, instruction: '改写课程内容。' },
      context,
    );

    const calls = createArtifactWithGenerationJob.mock.calls;
    expect(calls[0]![0].idempotencyKey).toBe(
      'general-turn-artifact:operation-1',
    );
    expect(calls[1]![0].idempotencyKey).toBe(calls[0]![0].idempotencyKey);
    expect(calls[1]![0].requestFingerprint).toBe(
      calls[0]![0].requestFingerprint,
    );
    expect(calls[2]![0].idempotencyKey).toBe(calls[0]![0].idempotencyKey);
    expect(calls[2]![0].requestFingerprint).not.toBe(
      calls[0]![0].requestFingerprint,
    );
  });
});
