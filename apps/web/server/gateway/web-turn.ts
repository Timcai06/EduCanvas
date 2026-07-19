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
  Sha256GatewayRequestFingerprint,
  type GatewayEventPayload,
  type GatewayTurnRunnerPort,
} from '@educanvas/gateway-runtime';
import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import type { TeachingTurnRequestBody } from '../http/turn-request';
import type { AnonymousIdentity } from '../identity/anonymous-identity';
import {
  beginGatewayGeneralTurn,
  prepareGatewayGeneralTurnContext,
} from '../platform/general-turn';
import { loadOwnedGeneralConversation } from '../platform/general-conversation';

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
      assetContext: string;
    },
  ) {}

  async *run(input: Parameters<GatewayTurnRunnerPort['run']>[0]) {
    let turn;
    try {
      turn = await beginGatewayGeneralTurn({
        operationId: input.operationId,
        identity: this.input.identity,
        conversationId: input.route.conversationId,
        spaceId: input.route.notebookId,
        request: this.input.request,
        assetContext: this.input.assetContext,
      });
    } catch (error) {
      this.preparationError = error;
      throw error;
    }
    yield* legacyToGateway(turn.events);
  }
}

function safeFailureMessage(
  code: string,
  audience: 'general' | 'teaching',
): string {
  if (code === 'RATE_LIMITED') return '请求较多，请稍后重试。';
  if (code === 'CAPABILITY_UNAVAILABLE') return '当前能力暂时不可用。';
  if (audience === 'teaching') {
    return 'AI 老师暂时无法连接，请稍后重试。';
  }
  return 'AI 暂时无法回答，请稍后重试。';
}

export async function* gatewayToLegacy(
  events: AsyncIterable<GatewayOperationEvent>,
  audience: 'general' | 'teaching' = 'general',
): AsyncGenerator<TeachingTurnEvent> {
  let assistantMessageId: string | null = null;
  for await (const event of events) {
    const base = { schemaVersion: '1' as const, turnId: event.operationId };
    switch (event.type) {
      case 'operation.accepted':
        break;
      case 'message.started':
        assistantMessageId = event.assistantMessageId;
        yield {
          ...base,
          type: 'turn.accepted',
          studentMessageId: event.userMessageId,
          assistantMessageId: event.assistantMessageId,
          replayed: event.replayed,
        };
        break;
      case 'message.delta':
        if (!assistantMessageId) break;
        yield {
          ...base,
          type: 'message.delta',
          messageId: assistantMessageId,
          delta: event.delta,
        };
        break;
      case 'message.citation': {
        const common = {
          ...base,
          type: 'message.citation' as const,
          messageId: event.messageId,
          citationId: event.citation.citationId,
          marker: event.citation.marker,
          label: event.citation.label,
          pageStart:
            event.citation.target.kind === 'knowledge'
              ? event.citation.target.pageStart
              : null,
          pageEnd:
            event.citation.target.kind === 'knowledge'
              ? event.citation.target.pageEnd
              : null,
        };
        if (event.citation.target.kind === 'web') {
          yield {
            ...common,
            kind: 'web',
            assetId: event.citation.target.assetId,
            assetVersionId: event.citation.target.assetVersionId,
            url: event.citation.target.url,
          };
        } else if (event.citation.target.kind === 'knowledge') {
          yield {
            ...common,
            kind: 'knowledge',
            sourceId: event.citation.target.sourceId,
            documentId: event.citation.target.documentId,
            chunkId: event.citation.target.chunkId,
          };
        }
        break;
      }
      case 'tool.started':
        yield {
          ...base,
          type: 'tool.started',
          toolCallId: event.toolCallId,
          label:
            event.tool === 'web.search'
              ? '正在搜索网页'
              : event.tool === 'web.fetch'
                ? '正在读取网页'
                : event.tool,
        };
        break;
      case 'tool.completed':
        yield { ...base, type: 'tool.completed', toolCallId: event.toolCallId };
        break;
      case 'tool.failed':
        yield {
          ...base,
          type: 'tool.failed',
          toolCallId: event.toolCallId,
          code: event.code,
        };
        break;
      case 'operation.completed':
        yield { ...base, type: 'turn.completed', messageId: event.messageId };
        break;
      case 'operation.failed':
        yield {
          ...base,
          type: 'turn.failed',
          messageId: assistantMessageId ?? event.operationId,
          code: event.code,
          message: safeFailureMessage(event.code, audience),
          retryable: event.retryable,
        };
        break;
      case 'operation.cancelled':
        yield {
          ...base,
          type: 'turn.cancelled',
          messageId: assistantMessageId ?? event.operationId,
        };
        break;
      case 'artifact.proposed':
        yield {
          ...base,
          type: 'artifact.proposed',
          artifactId: event.artifactId,
          kind: event.artifactKind,
          trustTier: 'tier1',
          title: event.title,
        };
        break;
      case 'artifact.version_added':
        yield {
          ...base,
          type: 'artifact.version_added',
          artifactId: event.artifactId,
          version: Number(event.versionId) || 1,
        };
        break;
      case 'artifact.generation_progress':
        yield { ...base, ...event };
        break;
      case 'artifact.failed':
        yield {
          ...base,
          type: 'artifact.failed',
          artifactId: event.artifactId,
          ...(event.jobId === null ? {} : { jobId: event.jobId }),
          code: event.code,
        };
        break;
      case 'approval.required':
      case 'approval.resolved':
        break;
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
  const principal = await identities.ensureAnonymousCompatibility({
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
      kind: 'anonymous_compat',
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
