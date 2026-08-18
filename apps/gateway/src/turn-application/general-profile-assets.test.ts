import type { TurnApplicationCommand } from '@educanvas/agent-core';
import type { NodeInvocationPersistencePort } from '@educanvas/node-runtime';
import { describe, expect, it, vi } from 'vitest';
import { GatewayGeneralProfile } from './general-profile';
import type { GatewayTurnRepositoryPort } from './lifecycle';

const turns = {
  async attachGatewayTurn() {
    throw new Error('not_used');
  },
  async settleTurn() {
    throw new Error('not_used');
  },
  async listMessages() {
    return [];
  },
  async isTurnCancellationRequested() {
    return false;
  },
} satisfies GatewayTurnRepositoryPort;

function nodeInvocations(
  capabilities: Awaited<
    ReturnType<
      NodeInvocationPersistencePort['listAvailableCapabilitiesForOperation']
    >
  >,
) {
  return {
    listAvailableCapabilitiesForOperation: vi.fn(async () => capabilities),
    async enqueueForOperation() {
      throw new Error('not_used');
    },
    async readInvocationOutcome() {
      return { status: 'pending' as const };
    },
    async expirePendingInvocation() {},
  } satisfies NodeInvocationPersistencePort;
}

const command: TurnApplicationCommand = {
  protocol: 'educanvas.turn.v2',
  operationId: 'operation:1',
  traceId: 'trace:1',
  actor: { actorId: 'user:1', agentId: 'agent:1' },
  notebook: {
    notebookId: 'notebook:1',
    conversationId: 'conversation:1',
  },
  profile: { profileId: 'general' },
  entrypoint: 'web',
  input: {
    clientMessageId: 'message:1',
    parts: [{ type: 'text', text: '看看这张图' }],
  },
  capabilities: ['input.image'],
};

const turn = {
  operationId: command.operationId,
  traceId: command.traceId,
  userMessageId: 'message:user:1',
  assistantMessageId: 'message:assistant:1',
  replayed: false,
};

describe('Gateway General Profile asset 物化（DP10）', () => {
  it('把asset_ref物化结果投影为sourcesAndAssets文本段与原生图候选', async () => {
    const versionId = 'version:asset:1';
    const materializer = {
      materializeOwnedReferences: vi.fn(async () => ({
        text: 'PDF文本',
        textSegments: [
          {
            reference: {
              assetId: 'asset:1',
              versionId,
              kind: 'document' as const,
            },
            text: 'PDF文本',
            representation: null,
          },
        ],
        nativeReferences: [],
        nativeImages: [
          {
            versionId: 'version:img:1',
            mimeType: 'image/png' as const,
            data: 'aGVsbG8=',
          },
        ],
      })),
    };
    const profile = new GatewayGeneralProfile(
      turns,
      nodeInvocations([]),
      [],
      'owner',
      materializer,
      ['image'],
    );
    const plan = await profile.prepare({
      command: {
        ...command,
        input: {
          clientMessageId: 'message:1',
          parts: [
            {
              type: 'asset_ref',
              reference: {
                assetId: 'asset:1',
                versionId,
                kind: 'document',
              },
              usage: 'attachment',
            },
          ],
        },
      },
      turn,
    });

    expect(materializer.materializeOwnedReferences).toHaveBeenCalledWith({
      trustedSubjectId: 'user:1',
      notebookId: 'notebook:1',
      nativeAssetKinds: ['image'],
      parts: [
        {
          type: 'asset_ref',
          reference: { assetId: 'asset:1', versionId, kind: 'document' },
          usage: 'attachment',
        },
      ],
    });
    const segments = plan.context.sourcesAndAssets;
    expect(segments[0]).toMatchObject({
      segment: {
        id: `asset:${versionId}`,
        kind: 'asset',
        assetVersionId: versionId,
      },
      message: { role: 'user' },
    });
    expect(segments[0]?.segment.content).toContain('PDF文本');
    expect(segments[1]?.segment).toMatchObject({
      kind: 'asset',
      id: 'asset-native:version:img:1',
    });
    expect(segments[1]?.message.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('untrusted_user_material'),
      },
      { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
    ]);
  });

  it('未注入materializer时保持空资产上下文（旧行为）', async () => {
    const profile = new GatewayGeneralProfile(
      turns,
      nodeInvocations([]),
      [],
      'owner',
      null,
      [],
    );
    const plan = await profile.prepare({ command, turn });
    expect(plan.context.sourcesAndAssets).toEqual([]);
  });
});
