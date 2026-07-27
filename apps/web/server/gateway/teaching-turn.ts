/**
 * 教学 Turn Gateway 适配器 — 将 Gateway 协议映射到 Web 教学 Turn Application。
 *
 * ## 职责
 *
 * Gateway Service 需要 `GatewayTurnRunnerPort`。
 * 本文件创建 `TeachingTurnApplicationRunner` 实现该接口，
 * 内部调用 `beginGatewayTeachingTurnApplication`（learning-turn.ts 的组合根）。
 *
 * ## 适配流程
 *
 * ```
 * Gateway Inbound Envelope →
 *   loadOwnedTeachingSession → loadOwnedTeachingGatewayTarget →
 *     beginGatewayTeachingTurnApplication → projectTurnApplicationEventToGateway →
 *       Gateway Outbound Event
 * ```
 *
 * 本文件不创建新的教学逻辑 — 只是 Gateway 协议层和教学 Turn Application 间的薄适配。
 */

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
  projectTurnApplicationEventToGateway,
  Sha256GatewayRequestFingerprint,
  type GatewayTurnRunnerPort,
} from '@educanvas/gateway-runtime';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import {
  beginGatewayTeachingTurnApplication,
  prepareGatewayTeachingTurnContext,
} from '../teaching/learning-turn';
import {
  loadOwnedTeachingGatewayTarget,
  loadOwnedTeachingSession,
} from '../teaching/learning-session';
import { gatewayToLegacy } from './turn-application-projection';

const identities = new DrizzleGatewayIdentityRepository();
const routes = new DrizzleGatewayRouteResolver();
const operations = new DrizzleGatewayOperationStore();
const fingerprints = new Sha256GatewayRequestFingerprint();

class TeachingTurnApplicationRunner implements GatewayTurnRunnerPort {
  preparationError: unknown = null;

  constructor(
    private readonly input: {
      identity: AnonymousIdentity;
      request: TeachingTurnRequestBody;
      session: NonNullable<
        Awaited<ReturnType<typeof loadOwnedTeachingSession>>
      >;
      assetContext: Awaited<
        ReturnType<typeof prepareGatewayTeachingTurnContext>
      >;
    },
  ) {}

  async *run(input: Parameters<GatewayTurnRunnerPort['run']>[0]) {
    let turn;
    try {
      turn = beginGatewayTeachingTurnApplication({
        operationId: input.operationId,
        traceId: input.traceId,
        route: input.route,
        identity: this.input.identity,
        session: this.input.session,
        request: this.input.request,
        assetContext: this.input.assetContext,
        signal: input.signal,
        transportCapabilities: input.envelope.capabilities.capabilities.map(
          (capability) => capability.name,
        ),
      });
    } catch (error) {
      this.preparationError = error;
      throw error;
    }
    for await (const event of turn.events) {
      yield projectTurnApplicationEventToGateway(event, {
        actorUserId: input.route.actorUserId,
        occurredAt: new Date().toISOString(),
      });
    }
  }
}

export async function beginTeachingGatewayTurn(
  identity: AnonymousIdentity,
  request: TeachingTurnRequestBody,
): Promise<{ events: AsyncIterable<TeachingTurnEvent> }> {
  const target = await loadOwnedTeachingGatewayTarget(identity);
  if (!target) throw new LearningSessionOwnershipError();
  const session = await loadOwnedTeachingSession(identity);
  if (!session || session.id !== target.sessionId) {
    throw new LearningSessionOwnershipError();
  }
  const assetContext = await prepareGatewayTeachingTurnContext({
    identity,
    notebookId: target.notebookId,
    request,
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
      kind: principal.kind === 'registered' ? 'user' : 'anonymous_compat',
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
  const runner = new TeachingTurnApplicationRunner({
    identity,
    request,
    session,
    assetContext,
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
