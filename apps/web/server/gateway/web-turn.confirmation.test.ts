import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getForExecution: vi.fn(),
  confirm: vi.fn(),
  prepareContext: vi.fn(),
  ensureRegistered: vi.fn(),
  beginTurn: vi.fn(),
  gatewayService: vi.fn(),
  gatewayEnvelope: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('@educanvas/db', () => ({
  DrizzleGatewayIdentityRepository: class {
    ensureRegistered = mocks.ensureRegistered;
  },
  DrizzleGatewayOperationStore: class {},
  DrizzleGatewayRouteResolver: class {},
  resolveGatewayTerminalReconciliationMode: () => 'strict',
  PlatformTurnOwnershipError: class extends Error {},
  DrizzleArtifactConfirmationRepository: class {
    getForExecution = mocks.getForExecution;
    confirm = mocks.confirm;
  },
  artifactConfirmationMessageId: (id: string) =>
    `artifact.confirm.${id.replaceAll('-', '')}`,
}));
vi.mock('@educanvas/gateway-core', () => ({
  gatewayProtocolVersion: 'gateway.v1',
}));
vi.mock('@educanvas/gateway-runtime', () => ({
  GatewayService: class {
    constructor(
      _routes: unknown,
      _operations: unknown,
      runner: {
        operationId: string | null;
        run(input: unknown): AsyncIterable<unknown>;
      },
    ) {
      runner.operationId = 'operation-confirmed';
      mocks.gatewayService();
      this.runner = runner;
    }
    private runner: {
      run(input: unknown): AsyncIterable<unknown>;
    };
    handle = (envelope: unknown) => {
      mocks.gatewayEnvelope = envelope;
      const runner = this.runner;
      return {
        [Symbol.asyncIterator]: async function* () {
          const events = runner.run({
            operationId: 'operation-confirmed',
            traceId: 'trace-confirmed',
            route: {
              actorUserId: 'owner-1',
              agentId: 'agent-1',
              notebookId: 'notebook-1',
              conversationId: 'conversation-1',
              agentProfileId: 'general',
              membershipRole: 'owner',
            },
            envelope,
            signal: new AbortController().signal,
          });
          await events[Symbol.asyncIterator]().next();
          yield { type: 'message.started', operationId: 'operation-confirmed' };
        },
      };
    };
    requestCancel = vi.fn(async () => undefined);
  },
  projectTurnApplicationEventToGateway: vi.fn(),
  Sha256GatewayRequestFingerprint: class {},
}));
vi.mock('../model/model-runtime', () => ({
  resolveTurnModelRuntime: () => null,
}));
vi.mock('../tools/web-search', () => ({ isWebSearchConfigured: () => true }));
vi.mock('../platform/general-turn', () => ({
  beginGatewayGeneralTurnApplication: mocks.beginTurn,
  prepareGatewayGeneralTurnContext: mocks.prepareContext,
}));
vi.mock('../platform/general-turn-persistence', () => ({
  webResearchCheckpoints: {},
}));
vi.mock('../platform/general-request-conversation-context', () => ({
  loadOwnedGeneralRequestConversation: vi.fn(async () => ({
    id: 'conversation-1',
    spaceId: 'notebook-1',
    agentProfileId: 'general',
  })),
}));
vi.mock('./turn-application-projection', () => ({
  gatewayToLegacy: (events: unknown) => events,
}));

import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { beginWebGatewayTurn } from './web-turn';

const identity: AnonymousIdentity = { studentId: 'owner-1', token: '' };
const confirmationId = '11111111-1111-4111-8111-111111111111';
const proposalParts = [
  {
    type: 'text' as const,
    text: '请依据 PDF 和选中的 Notebook 图片制作课件。',
  },
  {
    type: 'asset_ref' as const,
    reference: {
      assetId: '22222222-2222-4222-8222-222222222222',
      versionId: '33333333-3333-4333-8333-333333333333',
      kind: 'document' as const,
    },
    usage: 'attachment' as const,
  },
  {
    type: 'asset_ref' as const,
    reference: {
      assetId: '44444444-4444-4444-8444-444444444444',
      versionId: '55555555-5555-4555-8555-555555555555',
      kind: 'image' as const,
    },
    usage: 'context' as const,
  },
];
const request = {
  clientMessageId: 'artifact.confirm.11111111111141118111111111111111',
  text: '确认创建Slides',
  parts: [{ type: 'text' as const, text: '确认创建Slides' }],
  eventExtensions: ['artifact.confirmation@1'] as const,
  artifactConfirmationId: confirmationId,
  outputPreference: 'interactive_artifact' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getForExecution.mockResolvedValue({
    id: confirmationId,
    userMessageId: 'proposal-message-1',
    proposalParts,
    artifactKind: 'slides',
    confirmedKind: null,
    confirmationMessageId: null,
  });
  mocks.confirm.mockResolvedValue({
    status: 'confirmed',
    confirmedKind: 'slides',
  });
  mocks.prepareContext.mockResolvedValue({
    text: '',
    textSegments: [],
    nativeReferences: [],
    nativeImages: [],
  });
  mocks.ensureRegistered.mockResolvedValue({ userId: 'principal-1' });
  mocks.beginTurn.mockResolvedValue({ events: [] });
});

describe('confirmed artifact startup contract', () => {
  it('does not consume confirmation when runtime context preparation fails', async () => {
    mocks.prepareContext.mockRejectedValue(new Error('runtime unavailable'));

    await expect(beginWebGatewayTurn(identity, request)).rejects.toThrow(
      'runtime unavailable',
    );

    expect(mocks.getForExecution).toHaveBeenCalledOnce();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('maps the negotiated event extension to its exact Gateway capability version', async () => {
    await beginWebGatewayTurn(identity, request);

    expect(mocks.gatewayEnvelope).toMatchObject({
      capabilities: {
        capabilities: expect.arrayContaining([
          {
            name: 'artifact.confirmation',
            risk: 'l0',
            version: '1',
            constraints: {},
          },
        ]),
      },
    });
  });

  it('consumes once only after Gateway emits message.started', async () => {
    await beginWebGatewayTurn(identity, request);

    expect(mocks.confirm).toHaveBeenCalledWith({
      confirmationId,
      actorUserId: identity.studentId,
      notebookId: 'notebook-1',
      conversationId: 'conversation-1',
      artifactKind: 'slides',
      clientMessageId: request.clientMessageId,
    });
  });

  it('rematerializes only the persisted proposal PDF and Notebook source on confirmation', async () => {
    mocks.getForExecution.mockResolvedValueOnce({
      id: confirmationId,
      userMessageId: 'proposal-message-1',
      proposalParts,
      artifactKind: 'slides',
      confirmedKind: 'mind_map',
      confirmationMessageId: null,
    });
    const clientParts = [
      ...request.parts,
      {
        type: 'asset_ref' as const,
        reference: {
          assetId: '66666666-6666-4666-8666-666666666666',
          versionId: '77777777-7777-4777-8777-777777777777',
          kind: 'image' as const,
        },
        usage: 'attachment' as const,
      },
    ];

    await beginWebGatewayTurn(identity, { ...request, parts: clientParts });

    expect(mocks.getForExecution).toHaveBeenCalledWith({
      confirmationId,
      actorUserId: identity.studentId,
      notebookId: 'notebook-1',
      conversationId: 'conversation-1',
    });
    expect(mocks.prepareContext).toHaveBeenCalledWith(
      expect.objectContaining({
        identity,
        spaceId: 'notebook-1',
        request: expect.objectContaining({ parts: proposalParts }),
      }),
    );
    expect(mocks.prepareContext.mock.calls[0]?.[0].request.parts).not.toContain(
      clientParts.at(-1),
    );
    expect(mocks.beginTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmedArtifactKind: 'mind_map',
        request: expect.objectContaining({
          parts: [
            {
              type: 'text',
              text: '请根据前一条请求创建我刚确认的持久产物。',
            },
          ],
        }),
      }),
    );
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ artifactKind: 'mind_map' }),
    );
  });

  it('rebuilds source context from the same persisted parts on duplicate attempts', async () => {
    await beginWebGatewayTurn(identity, request);
    await beginWebGatewayTurn(identity, request);

    expect(mocks.getForExecution).toHaveBeenCalledTimes(2);
    expect(mocks.prepareContext).toHaveBeenCalledTimes(2);
    expect(
      mocks.prepareContext.mock.calls.map((call) => call[0].request.parts),
    ).toEqual([proposalParts, proposalParts]);
  });

  it('does not prepare or consume a cancelled or out-of-scope confirmation', async () => {
    mocks.getForExecution.mockRejectedValue(
      Object.assign(new Error('Artifact confirmation not found'), {
        code: 'artifact_confirmation_not_found',
      }),
    );

    await expect(beginWebGatewayTurn(identity, request)).rejects.toMatchObject({
      code: 'artifact_confirmation_not_found',
    });

    expect(mocks.prepareContext).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
