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
} from '@educanvas/db';
import {
  GatewayService,
  projectTurnApplicationEventToGateway,
  Sha256GatewayRequestFingerprint,
  type GatewayEventPayload,
  type GatewayTurnRunnerPort,
} from '@educanvas/gateway-runtime';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import {
  beginGatewayGeneralTurnApplication,
  prepareGatewayGeneralTurnContext,
} from '../platform/general-turn';
import { loadOwnedGeneralConversation } from '../platform/general-conversation';
import { gatewayToLegacy } from './turn-application-projection';

const identities = new DrizzleGatewayIdentityRepository();
const routes = new DrizzleGatewayRouteResolver();
const operations = new DrizzleGatewayOperationStore();
const fingerprints = new Sha256GatewayRequestFingerprint();

function toGatewayFailureCode(
  event: Extract<TeachingTurnEvent, { type: 'turn.failed' }>,
): Extract<GatewayEventPayload, { type: 'operation.failed' }>['code'] {
  if (event.code.includes('rate_limit')) return 'RATE_LIMITED';
  if (event.code.includes('aborted')) return 'CANCELLED';
  return 'RUNTIME_FAILED';
}

function toolName(label?: string): string {
  if (label?.includes('搜索')) return 'web.search';
  if (label?.includes('读取')) return 'web.fetch';
  return 'agent.tool';
}

export async function* legacyToGateway(
  events: AsyncIterable<TeachingTurnEvent>,
): AsyncGenerator<GatewayEventPayload> {
  for await (const event of events) {
    switch (event.type) {
      case 'turn.accepted':
        yield {
          type: 'message.started',
          userMessageId: event.studentMessageId,
          assistantMessageId: event.assistantMessageId,
          replayed: event.replayed,
        };
        break;
      case 'message.delta':
        yield { type: 'message.delta', delta: event.delta };
        break;
      case 'message.citation':
        yield {
          type: 'message.citation',
          messageId: event.messageId,
          citation: {
            citationId: event.citationId,
            ...(event.marker === undefined ? {} : { marker: event.marker }),
            label: event.label,
            target:
              event.kind === 'web'
                ? {
                    kind: 'web',
                    assetId: event.assetId,
                    assetVersionId: event.assetVersionId,
                    url: event.url,
                  }
                : {
                    kind: 'knowledge',
                    sourceId: event.sourceId,
                    documentId: event.documentId,
                    chunkId: event.chunkId,
                    pageStart: event.pageStart,
                    pageEnd: event.pageEnd,
                  },
          },
        };
        break;
      case 'tool.started':
        yield {
          type: 'tool.started',
          toolCallId: event.toolCallId,
          tool: toolName(event.label),
        };
        break;
      case 'tool.completed':
        yield {
          type: 'tool.completed',
          toolCallId: event.toolCallId,
          summary: { label: event.label ?? null },
        };
        break;
      case 'tool.failed':
        yield {
          type: 'tool.failed',
          toolCallId: event.toolCallId,
          code: 'CAPABILITY_UNAVAILABLE',
          retryable: true,
        };
        break;
      case 'turn.completed':
        yield { type: 'operation.completed', messageId: event.messageId };
        break;
      case 'turn.failed':
        yield {
          type: 'operation.failed',
          code: toGatewayFailureCode(event),
          retryable: event.retryable,
        };
        break;
      case 'turn.cancelled':
        yield { type: 'operation.cancelled' };
        break;
      case 'artifact.proposed':
      case 'artifact.created':
        yield {
          type: 'artifact.proposed',
          artifactId: event.artifactId,
          artifactKind: event.kind,
          title: event.title,
        };
        break;
      case 'artifact.version_added':
        yield {
          type: 'artifact.version_added',
          artifactId: event.artifactId,
          versionId: String(event.version),
        };
        break;
      case 'artifact.generation_progress':
        yield {
          type: 'artifact.generation_progress',
          artifactId: event.artifactId,
          jobId: event.jobId,
          progress: event.progress,
        };
        break;
      case 'artifact.failed':
        yield {
          type: 'artifact.failed',
          artifactId: event.artifactId,
          jobId: event.jobId ?? null,
          code: 'RUNTIME_FAILED',
        };
        break;
    }
  }
}

class WebCompatibilityRunner implements GatewayTurnRunnerPort {
  preparationError: unknown = null;

  constructor(
    private readonly input: {
      identity: AnonymousIdentity;
      request: TeachingTurnRequestBody;
      assetContext: Awaited<
        ReturnType<typeof prepareGatewayGeneralTurnContext>
      >;
    },
  ) {}

  async *run(input: Parameters<GatewayTurnRunnerPort['run']>[0]) {
    let turn;
    try {
      turn = beginGatewayGeneralTurnApplication({
        operationId: input.operationId,
        traceId: input.traceId,
        actorId: input.route.actorUserId,
        agentId: input.route.agentId,
        identity: this.input.identity,
        conversationId: input.route.conversationId,
        spaceId: input.route.notebookId,
        request: this.input.request,
        assetContext: this.input.assetContext,
        signal: input.signal,
        capabilities: input.envelope.capabilities.capabilities.map(
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

export async function beginWebGatewayTurn(
  identity: AnonymousIdentity,
  request: TeachingTurnRequestBody,
): Promise<{ events: AsyncIterable<TeachingTurnEvent> }> {
  const conversation = await loadOwnedGeneralConversation(identity);
  if (!conversation || conversation.agentProfileId !== 'general') {
    throw new PlatformTurnOwnershipError();
  }
  const assetContext = await prepareGatewayGeneralTurnContext({
    identity,
    spaceId: conversation.spaceId,
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
  async function* primed(): AsyncGenerator<GatewayOperationEvent> {
    yield* prefix;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  return { events: gatewayToLegacy(primed()) };
}
