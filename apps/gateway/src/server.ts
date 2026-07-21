import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  gatewayClientTurnRequestSchema,
  gatewayConnectionConnectRequestSchema,
  gatewayConnectionRevokeRequestSchema,
  gatewayHandoffCredentialSchema,
  gatewayHandoffIssueRequestSchema,
  gatewayOpaqueIdSchema,
  gatewayProtocolVersion,
  type GatewayInboundEnvelope,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import {
  GatewayConnectionRuntimeError,
  GatewayRuntimeError,
  type GatewayConnectionService,
  type GatewayService,
} from '@educanvas/gateway-runtime';
import {
  GatewayPersistenceError,
  type DrizzleGatewayDirectoryRepository,
  type DrizzleGatewayIdentityRepository,
  type DrizzleGatewayHandoffRepository,
  type DrizzleGatewayNodeRepository,
  type DrizzleGatewayApprovalRepository,
  type DrizzleGatewayOperationStore,
} from '@educanvas/db';
import { z, ZodError } from 'zod';
import {
  GatewayClientSessionAuth,
  GatewayNodeSessionAuth,
  readBearerToken,
} from './client-auth';
import { GatewayObservability, gatewayRouteLabel } from './observability';

const MAX_BODY_BYTES = 1_000_000;
const HANDOFF_TTL_MS = 2 * 60 * 1_000;

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error('EMPTY_BODY');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function writeEvent(
  response: ServerResponse,
  event: GatewayOperationEvent,
  observability?: GatewayObservability,
) {
  observability?.operation(event);
  response.write(`${JSON.stringify(event)}\n`);
}

function mapError(error: unknown): {
  status: number;
  code: string;
} {
  if (error instanceof ZodError)
    return { status: 400, code: 'INVALID_REQUEST' };
  if (error instanceof GatewayPersistenceError) {
    if (error.code === 'forbidden') return { status: 403, code: 'FORBIDDEN' };
    if (error.code === 'idempotency_conflict') {
      return { status: 409, code: 'IDEMPOTENCY_CONFLICT' };
    }
    if (error.code === 'invalid_event_sequence') {
      return { status: 409, code: 'INVALID_STATE' };
    }
    if (
      error.code === 'route_not_found' ||
      error.code === 'operation_not_found'
    ) {
      return { status: 404, code: 'NOT_FOUND' };
    }
  }
  if (error instanceof GatewayRuntimeError) {
    if (error.code === 'FORBIDDEN') return { status: 403, code: 'FORBIDDEN' };
    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      return { status: 409, code: 'IDEMPOTENCY_CONFLICT' };
    }
    if (
      error.code === 'ROUTE_NOT_FOUND' ||
      error.code === 'OPERATION_NOT_FOUND'
    ) {
      return { status: 404, code: 'NOT_FOUND' };
    }
  }
  if (error instanceof GatewayConnectionRuntimeError) {
    return {
      status: 409,
      code: error.code,
    };
  }
  if (
    error instanceof SyntaxError ||
    (error instanceof Error &&
      ['BODY_TOO_LARGE', 'EMPTY_BODY'].includes(error.message))
  ) {
    return {
      status: error.message === 'BODY_TOO_LARGE' ? 413 : 400,
      code: 'INVALID_REQUEST',
    };
  }
  return { status: 500, code: 'INTERNAL_ERROR' };
}

export function createGatewayHttpHandler(input: {
  service: GatewayService;
  internalToken: string | null;
  clientTransport?: {
    bootstrapToken: string | null;
    sessionAuth: GatewayClientSessionAuth;
    identities: Pick<
      DrizzleGatewayIdentityRepository,
      'ensureRegistered' | 'getActive'
    >;
    directory: Pick<DrizzleGatewayDirectoryRepository, 'listConversations'>;
    localOnboarding?: {
      userId: string;
      ensureWorkspace: (userId: string) => Promise<unknown>;
    } | null;
    approvals: Pick<DrizzleGatewayApprovalRepository, 'listPending'>;
    operations: Pick<
      DrizzleGatewayOperationStore,
      'listRecent' | 'resolveApproval'
    >;
    handoffs: Pick<DrizzleGatewayHandoffRepository, 'issue'>;
    connections: Pick<GatewayConnectionService, 'list' | 'connect' | 'revoke'>;
  } | null;
  nodeTransport?: {
    bootstrapToken: string;
    sessionAuth: GatewayNodeSessionAuth;
    nodes: Pick<
      DrizzleGatewayNodeRepository,
      'pair' | 'getActive' | 'heartbeat' | 'poll' | 'settle' | 'enqueue'
    >;
  } | null;
  observability?: GatewayObservability;
}) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://gateway.internal');
    const finishHttp = input.observability?.beginHttp({
      method: request.method ?? 'UNKNOWN',
      route: gatewayRouteLabel(request.method ?? 'UNKNOWN', url.pathname),
    });
    let httpFinished = false;
    const settleHttp = (status: number) => {
      if (httpFinished) return;
      httpFinished = true;
      finishHttp?.(status);
    };
    response.once('finish', () => settleHttp(response.statusCode));
    response.once('close', () =>
      settleHttp(response.writableEnded ? response.statusCode : 499),
    );
    if (request.method === 'GET' && url.pathname === '/healthz') {
      writeJson(response, 200, {
        service: 'educanvas-gateway',
        status: 'ok',
        protocol: 'gateway.v1',
      });
      return;
    }
    if (url.pathname.startsWith('/v1/internal/')) {
      if (input.internalToken === null) {
        writeJson(response, 503, {
          error: { code: 'INTERNAL_TRANSPORT_DISABLED' },
        });
        return;
      }
      if (!isAuthorized(request, input.internalToken)) {
        writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
        return;
      }
    }

    try {
      if (request.method === 'POST' && url.pathname === '/v1/local/onboard') {
        const client = input.clientTransport ?? null;
        const remoteAddress = request.socket.remoteAddress ?? '';
        const isLoopback =
          remoteAddress === '127.0.0.1' ||
          remoteAddress === '::1' ||
          remoteAddress === '::ffff:127.0.0.1';
        if (!client?.localOnboarding || !isLoopback) {
          writeJson(response, 404, { error: { code: 'NOT_FOUND' } });
          return;
        }
        const identity = await client.identities.ensureRegistered({
          trustedSubjectId: client.localOnboarding.userId,
        });
        await client.localOnboarding.ensureWorkspace(identity.userId);
        writeJson(response, 200, {
          userId: identity.userId,
          agentId: identity.agentId,
          ...client.sessionAuth.issue(identity.userId),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/internal/metrics') {
        writeJson(response, 200, input.observability?.snapshot() ?? {});
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/node/pair') {
        const nodes = input.nodeTransport ?? null;
        if (!nodes) {
          writeJson(response, 503, {
            error: { code: 'NODE_TRANSPORT_DISABLED' },
          });
          return;
        }
        if (!isAuthorized(request, nodes.bootstrapToken)) {
          writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
          return;
        }
        const body = z
          .object({ userId: gatewayOpaqueIdSchema, request: z.unknown() })
          .strict()
          .parse(await readJsonBody(request));
        const pairing = await nodes.nodes.pair(body);
        writeJson(response, 200, {
          pairing,
          ...nodes.sessionAuth.issue({
            nodeId: pairing.nodeId,
            userId: pairing.userId,
          }),
        });
        return;
      }

      if (url.pathname.startsWith('/v1/node/')) {
        const nodes = input.nodeTransport ?? null;
        const token = readBearerToken(request.headers.authorization);
        const claims = nodes && token ? nodes.sessionAuth.verify(token) : null;
        if (!nodes) {
          writeJson(response, 503, {
            error: { code: 'NODE_TRANSPORT_DISABLED' },
          });
          return;
        }
        if (!claims || !(await nodes.nodes.getActive(claims.nodeId))) {
          writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
          return;
        }
        if (
          request.method === 'POST' &&
          url.pathname === '/v1/node/heartbeat'
        ) {
          const body = (await readJsonBody(request)) as { nodeId?: unknown };
          if (body.nodeId !== claims.nodeId) {
            writeJson(response, 403, { error: { code: 'FORBIDDEN' } });
            return;
          }
          await nodes.nodes.heartbeat(body);
          writeJson(response, 200, { status: 'ok' });
          return;
        }
        if (
          request.method === 'GET' &&
          url.pathname === '/v1/node/invocations'
        ) {
          writeJson(response, 200, {
            invocations: await nodes.nodes.poll(claims.nodeId),
          });
          return;
        }
        if (
          request.method === 'POST' &&
          url.pathname === '/v1/node/invocation-results'
        ) {
          const body = (await readJsonBody(request)) as { nodeId?: unknown };
          if (body.nodeId !== claims.nodeId) {
            writeJson(response, 403, { error: { code: 'FORBIDDEN' } });
            return;
          }
          writeJson(response, 200, { result: await nodes.nodes.settle(body) });
          return;
        }
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/v1/client/bootstrap'
      ) {
        const client = input.clientTransport ?? null;
        if (!client || !client.bootstrapToken) {
          writeJson(response, 503, {
            error: { code: 'CLIENT_TRANSPORT_DISABLED' },
          });
          return;
        }
        if (!isAuthorized(request, client.bootstrapToken)) {
          writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
          return;
        }
        const body = z
          .object({ userId: gatewayOpaqueIdSchema })
          .strict()
          .parse(await readJsonBody(request));
        const identity = await client.identities.ensureRegistered({
          trustedSubjectId: body.userId,
        });
        writeJson(response, 200, {
          userId: identity.userId,
          agentId: identity.agentId,
          ...client.sessionAuth.issue(identity.userId),
        });
        return;
      }

      if (url.pathname.startsWith('/v1/client/')) {
        const client = input.clientTransport ?? null;
        const token = readBearerToken(request.headers.authorization);
        const claims =
          client && token ? client.sessionAuth.verify(token) : null;
        if (!client) {
          writeJson(response, 503, {
            error: { code: 'CLIENT_TRANSPORT_DISABLED' },
          });
          return;
        }
        if (!claims) {
          writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
          return;
        }
        const identity = await client.identities.getActive(claims.userId);
        if (!identity) {
          writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
          return;
        }

        if (
          request.method === 'GET' &&
          url.pathname === '/v1/client/conversations'
        ) {
          writeJson(response, 200, {
            conversations: await client.directory.listConversations(
              identity.userId,
            ),
          });
          return;
        }

        if (
          request.method === 'GET' &&
          url.pathname === '/v1/client/approvals'
        ) {
          writeJson(response, 200, {
            approvals: await client.approvals.listPending(identity.userId),
          });
          return;
        }

        if (
          request.method === 'GET' &&
          url.pathname === '/v1/client/operations'
        ) {
          writeJson(response, 200, {
            operations: await client.operations.listRecent(identity.userId),
          });
          return;
        }

        if (
          request.method === 'GET' &&
          url.pathname === '/v1/client/connections'
        ) {
          writeJson(
            response,
            200,
            await client.connections.list(identity.userId),
          );
          return;
        }

        if (
          request.method === 'POST' &&
          url.pathname === '/v1/client/connections/connect'
        ) {
          const requestBody = gatewayConnectionConnectRequestSchema.parse(
            await readJsonBody(request),
          );
          writeJson(
            response,
            201,
            await client.connections.connect({
              userId: identity.userId,
              request: requestBody,
            }),
          );
          return;
        }

        if (
          request.method === 'POST' &&
          url.pathname === '/v1/client/connections/revoke'
        ) {
          const requestBody = gatewayConnectionRevokeRequestSchema.parse(
            await readJsonBody(request),
          );
          writeJson(
            response,
            200,
            await client.connections.revoke({
              userId: identity.userId,
              connectionId: requestBody.connectionId,
            }),
          );
          return;
        }

        if (
          request.method === 'POST' &&
          url.pathname === '/v1/client/handoffs'
        ) {
          const body = gatewayHandoffIssueRequestSchema.parse(
            await readJsonBody(request),
          );
          const token = randomBytes(32).toString('base64url');
          const issuedAt = new Date();
          const expiresAt = new Date(issuedAt.getTime() + HANDOFF_TTL_MS);
          await client.handoffs.issue({
            tokenDigest: createHash('sha256')
              .update(token, 'utf8')
              .digest('hex'),
            userId: identity.userId,
            conversationId: body.conversationId,
            issuedAt,
            expiresAt,
          });
          writeJson(
            response,
            201,
            gatewayHandoffCredentialSchema.parse({
              token,
              expiresAt: expiresAt.toISOString(),
            }),
          );
          return;
        }

        const cancelMatch =
          request.method === 'POST'
            ? url.pathname.match(
                /^\/v1\/client\/operations\/([A-Za-z0-9._:-]+)\/cancel$/,
              )
            : null;
        if (cancelMatch) {
          const result = await input.service.requestCancel({
            operationId: cancelMatch[1]!,
            principalUserId: identity.userId,
          });
          writeJson(response, 200, result);
          return;
        }

        const approvalMatch =
          request.method === 'POST'
            ? url.pathname.match(
                /^\/v1\/client\/approvals\/([A-Za-z0-9._:-]+)\/decision$/,
              )
            : null;
        if (approvalMatch) {
          const body = z
            .object({
              status: z.enum(['approved', 'denied']),
              reason: z.string().trim().min(1).max(500).optional(),
            })
            .strict()
            .parse(await readJsonBody(request));
          const resolved = await client.operations.resolveApproval({
            approvalId: approvalMatch[1]!,
            actorUserId: identity.userId,
            ...body,
          });
          writeJson(response, 200, resolved);
          return;
        }

        if (request.method === 'POST' && url.pathname === '/v1/client/turns') {
          const body = gatewayClientTurnRequestSchema.parse(
            await readJsonBody(request),
          );
          const now = new Date().toISOString();
          const connectionId = `client:${randomUUID()}`;
          const envelope: GatewayInboundEnvelope = {
            protocol: gatewayProtocolVersion,
            envelopeId: `client:${body.clientMessageId}`,
            idempotencyKey: body.clientMessageId,
            occurredAt: now,
            connection: {
              connectionId,
              role: 'client',
              transport: 'tui',
              adapterId: 'educanvas.tui',
            },
            principal: {
              subjectId: identity.userId,
              userId: identity.userId,
              agentId: identity.agentId,
              kind: identity.kind === 'registered' ? 'user' : identity.kind,
              authenticationMethod: 'bearer',
              authenticatedAt: now,
            },
            routeHint: {
              notebookId: body.notebookId,
              conversationId: body.conversationId,
            },
            parts: body.parts,
            capabilities: {
              manifestId: `tui:${body.clientMessageId}`,
              issuedAt: now,
              capabilities: [
                {
                  name: 'input.text',
                  risk: 'l0',
                  version: '1',
                  constraints: {},
                },
                {
                  name: 'output.markdown',
                  risk: 'l0',
                  version: '1',
                  constraints: {},
                },
                {
                  name: 'output.stream',
                  risk: 'l0',
                  version: '1',
                  constraints: {},
                },
                {
                  name: 'approval.interactive',
                  risk: 'l1',
                  version: '1',
                  constraints: {},
                },
              ],
            },
            replyTarget: { kind: 'connection', connectionId },
          };
          const iterator = input.service
            .handle(envelope)
            [Symbol.asyncIterator]();
          const first = await iterator.next();
          response.writeHead(200, {
            'content-type': 'application/x-ndjson; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          });
          if (!first.done)
            writeEvent(response, first.value, input.observability);
          while (true) {
            const next = await iterator.next();
            if (next.done) break;
            writeEvent(response, next.value, input.observability);
          }
          response.end();
          return;
        }

        const operationMatch =
          request.method === 'GET'
            ? url.pathname.match(
                /^\/v1\/client\/operations\/([A-Za-z0-9._:-]+)\/events$/,
              )
            : null;
        if (operationMatch) {
          const after = Number(url.searchParams.get('after') ?? '-1');
          if (!Number.isInteger(after) || after < -1) {
            writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
            return;
          }
          writeJson(response, 200, {
            events: await input.service.resume({
              operationId: operationMatch[1]!,
              afterSequence: after,
              principalUserId: identity.userId,
            }),
          });
          return;
        }
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/v1/internal/envelopes'
      ) {
        const body = await readJsonBody(request);
        response.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        for await (const event of input.service.handle(body)) {
          writeEvent(response, event, input.observability);
        }
        response.end();
        return;
      }

      const nodeInvocationMatch =
        request.method === 'POST'
          ? url.pathname.match(
              /^\/v1\/internal\/nodes\/([A-Za-z0-9._:-]+)\/invocations$/,
            )
          : null;
      if (nodeInvocationMatch) {
        if (!input.nodeTransport) {
          writeJson(response, 503, {
            error: { code: 'NODE_TRANSPORT_DISABLED' },
          });
          return;
        }
        const body = (await readJsonBody(request)) as Record<string, unknown>;
        writeJson(response, 202, {
          invocation: await input.nodeTransport.nodes.enqueue({
            ...body,
            nodeId: nodeInvocationMatch[1],
          }),
        });
        return;
      }

      const match =
        request.method === 'GET'
          ? url.pathname.match(
              /^\/v1\/internal\/operations\/([A-Za-z0-9._:-]+)\/events$/,
            )
          : null;
      if (match) {
        const actorUserId = request.headers['x-educanvas-user-id'];
        if (typeof actorUserId !== 'string' || actorUserId.length > 160) {
          writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
          return;
        }
        const after = Number(url.searchParams.get('after') ?? '-1');
        if (!Number.isInteger(after) || after < -1) {
          writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
          return;
        }
        const events = await input.service.resume({
          operationId: match[1]!,
          afterSequence: after,
          principalUserId: actorUserId,
        });
        writeJson(response, 200, { events });
        return;
      }

      writeJson(response, 404, { error: { code: 'NOT_FOUND' } });
    } catch (error) {
      const mapped = mapError(error);
      if (!response.headersSent) {
        writeJson(response, mapped.status, { error: { code: mapped.code } });
      } else {
        response.destroy();
      }
    }
  };
}
