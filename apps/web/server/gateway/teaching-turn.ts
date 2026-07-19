import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  gatewayProtocolVersion,
  type GatewayInboundEnvelope,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import {
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayOperationStore,
  DrizzleGatewayRouteResolver,
  LearningSessionOwnershipError,
} from '@educanvas/db';
import {
  GatewayService,
  Sha256GatewayRequestFingerprint,
  type GatewayTurnRunnerPort,
} from '@educanvas/gateway-runtime';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import { beginGatewayTeachingTurn } from '../teaching/learning-turn';
import { loadOwnedTeachingGatewayTarget } from '../teaching/learning-session';
import { gatewayToLegacy, legacyToGateway } from './web-turn';

const identities = new DrizzleGatewayIdentityRepository();
const routes = new DrizzleGatewayRouteResolver();
const operations = new DrizzleGatewayOperationStore();
const fingerprints = new Sha256GatewayRequestFingerprint();

class TeachingCompatibilityRunner implements GatewayTurnRunnerPort {
  preparationError: unknown = null;

  constructor(
    private readonly input: {
      identity: AnonymousIdentity;
      request: TeachingTurnRequestBody;
      sessionId: string;
    },
  ) {}

  async *run(input: Parameters<GatewayTurnRunnerPort['run']>[0]) {
    let turn;
    try {
      turn = await beginGatewayTeachingTurn({
        operationId: input.operationId,
        expectedSessionId: this.input.sessionId,
        identity: this.input.identity,
        request: this.input.request,
      });
    } catch (error) {
      this.preparationError = error;
      throw error;
    }
    yield* legacyToGateway(turn.events);
  }
}

export async function beginTeachingGatewayTurn(
  identity: AnonymousIdentity,
  request: TeachingTurnRequestBody,
): Promise<{ events: AsyncIterable<TeachingTurnEvent> }> {
  const target = await loadOwnedTeachingGatewayTarget(identity);
  if (!target) throw new LearningSessionOwnershipError();
  const principal = await identities.ensureAnonymousCompatibility({
    trustedSubjectId: identity.studentId,
  });
  const now = new Date().toISOString();
  const connectionId = `web:${randomUUID()}`;
  const envelope: GatewayInboundEnvelope = {
    protocol: gatewayProtocolVersion,
    envelopeId: `web-learn:${request.clientMessageId}`,
    idempotencyKey: request.clientMessageId,
    occurredAt: now,
    connection: {
      connectionId,
      role: 'client',
      transport: 'web',
      adapterId: 'educanvas.web.learn',
    },
    principal: {
      subjectId: identity.studentId,
      userId: principal.userId,
      agentId: principal.agentId,
      kind: 'anonymous_compat',
      authenticationMethod: 'session_cookie',
      authenticatedAt: now,
    },
    routeHint: {
      notebookId: target.notebookId,
      conversationId: target.conversationId,
    },
    parts: [...request.parts],
    capabilities: {
      manifestId: `web-learn:${request.clientMessageId}`,
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
  const runner = new TeachingCompatibilityRunner({
    identity,
    request,
    sessionId: target.sessionId,
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
    throw new Error('gateway_teaching_turn_did_not_start');
  }
  async function* primed(): AsyncGenerator<GatewayOperationEvent> {
    yield* prefix;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  return { events: gatewayToLegacy(primed(), 'teaching') };
}
