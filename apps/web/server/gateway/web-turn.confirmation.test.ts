import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getForExecution: vi.fn(),
  confirm: vi.fn(),
  prepareContext: vi.fn(),
  ensureRegistered: vi.fn(),
  beginTurn: vi.fn(),
  gatewayService: vi.fn(),
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
vi.mock('@educanvas/gateway-core', () => ({ gatewayProtocolVersion: 'gateway.v1' }));
vi.mock('@educanvas/gateway-runtime', () => ({
  GatewayService: class {
    constructor(_routes: unknown, _operations: unknown, runner: { operationId: string | null }) {
      runner.operationId = 'operation-confirmed';
      mocks.gatewayService();
    }
    handle = () => ({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'message.started', operationId: 'operation-confirmed' };
      },
    });
    requestCancel = vi.fn(async () => undefined);
  },
  projectTurnApplicationEventToGateway: vi.fn(),
  Sha256GatewayRequestFingerprint: class {},
}));
vi.mock('../model/model-runtime', () => ({ resolveTurnModelRuntime: () => null }));
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
vi.mock('./turn-application-projection', () => ({ gatewayToLegacy: (events: unknown) => events }));

import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { beginWebGatewayTurn } from './web-turn';

const identity: AnonymousIdentity = { studentId: 'owner-1', token: '' };
const confirmationId = '11111111-1111-4111-8111-111111111111';
const request = {
  clientMessageId: 'artifact.confirm.11111111111141118111111111111111',
  text: '确认创建Slides',
  parts: [{ type: 'text' as const, text: '确认创建Slides' }],
  supportsArtifactConfirmation: true,
  artifactConfirmationId: confirmationId,
  outputPreference: 'interactive_artifact' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getForExecution.mockResolvedValue({
    id: confirmationId,
    artifactKind: 'slides',
    confirmedKind: null,
    confirmationMessageId: null,
  });
  mocks.confirm.mockResolvedValue({ status: 'confirmed', confirmedKind: 'slides' });
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

  it('consumes once only after Gateway emits message.started', async () => {
    await beginWebGatewayTurn(identity, request);

    expect(mocks.confirm).toHaveBeenCalledWith({
      confirmationId,
      actorUserId: identity.studentId,
      notebookId: 'notebook-1',
      conversationId: 'conversation-1',
      artifactKind: 'slides',
    });
  });
});
