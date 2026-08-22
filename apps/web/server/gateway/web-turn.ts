import 'server-only';

import { randomUUID } from 'node:crypto';
import type {
  GatewayInboundEnvelope,
  GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { gatewayProtocolVersion } from '@educanvas/gateway-core';
import {
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayOperationStore,
  DrizzleGatewayRouteResolver,
  PlatformTurnOwnershipError,
  resolveGatewayTerminalReconciliationMode,
} from '@educanvas/db';
import {
  GatewayService,
  projectTurnApplicationEventToGateway,
  Sha256GatewayRequestFingerprint,
  type GatewayTurnRunnerPort,
} from '@educanvas/gateway-runtime';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { resolveTurnModelRuntime } from '../model/model-runtime';
import { isWebSearchConfigured } from '../tools/web-search';
import {
  beginGatewayGeneralTurnApplication,
  prepareGatewayGeneralTurnContext,
} from '../platform/general-turn';
import { webResearchCheckpoints } from '../platform/general-turn-persistence';
import { loadOwnedGeneralConversation } from '../platform/general-conversation';
import { gatewayToLegacy } from './turn-application-projection';

const identities = new DrizzleGatewayIdentityRepository();
const routes = new DrizzleGatewayRouteResolver();
const operations = new DrizzleGatewayOperationStore(undefined, {
  terminalReconciliationMode: resolveGatewayTerminalReconciliationMode(
    process.env.EDUCANVAS_GATEWAY_TERMINAL_RECONCILIATION_MODE,
  ),
});
const fingerprints = new Sha256GatewayRequestFingerprint();

class WebCompatibilityRunner implements GatewayTurnRunnerPort {
  preparationError: unknown = null;
  operationId: string | null = null;

  constructor(
    private readonly input: {
      identity: AnonymousIdentity;
      request: TeachingTurnRequestBody;
      assetContext: Awaited<
        ReturnType<typeof prepareGatewayGeneralTurnContext>
      >;
      modelRuntime: ReturnType<typeof resolveTurnModelRuntime>;
    },
  ) {}

  async *run(input: Parameters<GatewayTurnRunnerPort['run']>[0]) {
    this.operationId = input.operationId;
    let turn;
    try {
      turn = await beginGatewayGeneralTurnApplication({
        operationId: input.operationId,
        traceId: input.traceId,
        route: input.route,
        identity: this.input.identity,
        request: this.input.request,
        assetContext: this.input.assetContext,
        signal: input.signal,
        transportCapabilities: input.envelope.capabilities.capabilities.map(
          (capability) => capability.name,
        ),
        modelRuntime: this.input.modelRuntime,
      });
    } catch (error) {
      this.preparationError = error;
      throw error;
    }
    for await (const event of turn.events) {
      if (
        this.input.request.mode === 'deep_research' &&
        event.type === 'message.delta'
      ) {
        await webResearchCheckpoints.advancePhase({
          operationId: input.operationId,
          conversationId: input.route.conversationId,
          actorId: input.route.actorUserId,
          phase: 'synthesizing',
        });
      }
      yield projectTurnApplicationEventToGateway(event, {
        actorUserId: input.route.actorUserId,
        occurredAt: new Date().toISOString(),
      });
    }
  }
}

export async function beginWebGatewayTurn(
  identity: AnonymousIdentity,
  request: TeachingTurnRequestBody,
): Promise<{
  events: AsyncIterable<TeachingTurnEvent>;
  cancel: () => Promise<void>;
}> {
  if (request.mode === 'deep_research' && !isWebSearchConfigured()) {
    throw Object.assign(new Error('deep_research_unavailable'), {
      code: 'deep_research_unavailable' as const,
    });
  }
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation || conversation.agentProfileId !== 'general') {
    throw new PlatformTurnOwnershipError();
  }
  const modelRuntime = resolveTurnModelRuntime();
  const assetContext = await prepareGatewayGeneralTurnContext({
    identity,
    spaceId: conversation.spaceId,
    request,
    modelRuntime,
  });
  const principal = identity.studentId.startsWith('anon:')
    ? await identities.ensureAnonymousCompatibility({
        trustedSubjectId: identity.studentId,
      })
    : await identities.ensureRegistered({
        trustedSubjectId: identity.studentId,
      });
  const now = new Date().toISOString();
  const connectionId = `web:${randomUUID()}`;
  const envelope: GatewayInboundEnvelope = {
    protocol: gatewayProtocolVersion,
    envelopeId: `web:${request.clientMessageId}`,
    idempotencyKey: request.clientMessageId,
    occurredAt: now,
    connection: {
      connectionId,
      role: 'client',
      transport: 'web',
      adapterId: 'educanvas.web',
    },
    principal: {
      subjectId: identity.studentId,
      userId: principal.userId,
      agentId: principal.agentId,
      kind: principal.kind === 'registered' ? 'user' : 'anonymous_compat',
      authenticationMethod: 'session_cookie',
      authenticatedAt: now,
    },
    routeHint: {
      notebookId: conversation.spaceId,
      conversationId: conversation.id,
    },
    parts: [...request.parts],
    capabilities: {
      manifestId: `web:${request.clientMessageId}`,
      issuedAt: now,
      capabilities: [
        { name: 'input.text', risk: 'l0', version: '1', constraints: {} },
        { name: 'input.file', risk: 'l0', version: '1', constraints: {} },
        { name: 'output.markdown', risk: 'l0', version: '1', constraints: {} },
        { name: 'output.stream', risk: 'l0', version: '1', constraints: {} },
        { name: 'artifact.native', risk: 'l1', version: '1', constraints: {} },
      ],
    },
    replyTarget: { kind: 'connection', connectionId },
  };
  const runner = new WebCompatibilityRunner({
    identity,
    request,
    assetContext,
    modelRuntime,
  });
  const service = new GatewayService(routes, operations, runner, fingerprints);
  const iterator = service.handle(envelope)[Symbol.asyncIterator]();
  const prefix: GatewayOperationEvent[] = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) break;
    prefix.push(next.value);
    if (
      next.value.type === 'message.started' ||
      next.value.type === 'operation.completed' ||
      next.value.type === 'operation.failed' ||
      next.value.type === 'operation.cancelled'
    ) {
      break;
    }
  }
  if (runner.preparationError !== null) throw runner.preparationError;
  if (!prefix.some((event) => event.type === 'message.started')) {
    throw new Error('gateway_turn_did_not_start');
  }
  const operationId = runner.operationId;
  if (!operationId) throw new Error('gateway_turn_operation_missing');
  async function* primed(): AsyncGenerator<GatewayOperationEvent> {
    yield* prefix;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  return {
    events: gatewayToLegacy(primed()),
    cancel: async () => {
      await service.requestCancel({
        operationId,
        principalUserId: principal.userId,
      });
    },
  };
}

/**
 * 只从 GatewayOperationEvents 恢复已持久化的 Web Turn。
 * 该入口不能构造 runner 或启动 Agent Loop；事件存储自身负责 actor ownership 校验。
 */
export async function resumeWebGatewayTurn(
  identity: AnonymousIdentity,
  input: { turnId: string; afterSequence: number },
): Promise<readonly GatewayOperationEvent[]> {
  return operations.listEvents(
    input.turnId,
    input.afterSequence,
    identity.studentId,
  );
}
