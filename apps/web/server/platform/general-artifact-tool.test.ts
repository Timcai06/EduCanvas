import type { AgentToolContext } from '@educanvas/agent-runtime';
import type { PlatformArtifact, PlatformArtifactJob } from '@educanvas/db';
import { describe, expect, it, vi } from 'vitest';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { WebOperationArtifacts } from './general-artifact-tool';

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
  status: 'queued',
  progress: null,
  failureCode: null,
  params: {},
  checkpoint: {},
  queueJobKey: `artifact-generate:${artifact.id}`,
};

describe('WebOperationArtifacts', () => {
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
      kind: 'mind_map',
      trustTier: 'tier1',
      title: artifact.title,
      taskIdentifier: 'artifact:generate',
      params: {
        generation: {
          instruction: '围绕分数的意义、运算规则和常见错误整理。',
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
});
