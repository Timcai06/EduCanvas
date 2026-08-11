import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  gatewayClientTurnRequestSchema,
  gatewayConnectionConnectRequestSchema,
  gatewayConnectionRevokeRequestSchema,
  gatewayHandoffCredentialSchema,
  gatewayHandoffIssueRequestSchema,
  gatewayOpaqueIdSchema,
  gatewayProtocolVersion,
  type GatewayInboundEnvelope,
} from '@educanvas/gateway-core';
import { canvasResourceKindSchema } from '@educanvas/canvas-protocol';
import { z } from 'zod';
import { readBearerToken } from '../client-auth';
import { GatewayCanvasResourceError } from '../canvas-resource-service';
import { handleDesktopRevoke, resolveClientAuth } from './client-request-auth';
import {
  HANDLED,
  UNHANDLED,
  isAuthorized,
  readJsonBody,
  writeEvent,
  writeJson,
  type GatewayRouteContext,
  type GatewayRouteResult,
} from './common';

const HANDOFF_TTL_MS = 2 * 60 * 1_000;

/**
 * 本地 IdP 引导：仅接受回环地址，且服务端固定用户身份，绝不接收客户端传入的用户 id。
 */
export async function handleLocalOnboard(
  ctx: GatewayRouteContext,
): Promise<GatewayRouteResult> {
  const { request, response, url, deps } = ctx;
  if (request.method === 'POST' && url.pathname === '/v1/local/onboard') {
    const client = deps.clientTransport ?? null;
    const remoteAddress = request.socket.remoteAddress ?? '';
    const isLoopback =
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::1' ||
      remoteAddress === '::ffff:127.0.0.1';
    if (!client?.localOnboarding || !isLoopback) {
      writeJson(response, 404, { error: { code: 'NOT_FOUND' } });
      return HANDLED;
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
    return HANDLED;
  }
  return UNHANDLED;
}

/**
 * /v1/client/* 路由：bootstrap 使用 bootstrap token 换取 Client session，其余端点使用
 * Client session token。bootstrap 在 session 组之前处理；session 组鉴权通过但子路由未命中时
 * 返回 unhandled，交回顶层收敛为 404（与拆分前一致）。
 */
export async function handleClientRoutes(
  ctx: GatewayRouteContext,
): Promise<GatewayRouteResult> {
  const { request, response, url, deps } = ctx;

  if (request.method === 'POST' && url.pathname === '/v1/client/bootstrap') {
    const client = deps.clientTransport ?? null;
    if (!client || !client.bootstrapToken) {
      writeJson(response, 503, {
        error: { code: 'CLIENT_TRANSPORT_DISABLED' },
      });
      return HANDLED;
    }
    if (!isAuthorized(request, client.bootstrapToken)) {
      writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
      return HANDLED;
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
    return HANDLED;
  }

  if (url.pathname.startsWith('/v1/client/')) {
    const client = deps.clientTransport ?? null;
    const token = readBearerToken(request.headers.authorization);
    if (!client) {
      writeJson(response, 503, {
        error: { code: 'CLIENT_TRANSPORT_DISABLED' },
      });
      return HANDLED;
    }
    const auth = await resolveClientAuth(client, token);
    if (!auth) {
      writeJson(response, 401, { error: { code: 'UNAUTHENTICATED' } });
      return HANDLED;
    }
    const { identity } = auth;
    if (await handleDesktopRevoke(ctx, client, auth.desktopToken)) {
      return HANDLED;
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
      return HANDLED;
    }

    if (request.method === 'GET' && url.pathname === '/v1/client/approvals') {
      writeJson(response, 200, {
        approvals: await client.approvals.listPending(identity.userId),
      });
      return HANDLED;
    }

    if (request.method === 'GET' && url.pathname === '/v1/client/operations') {
      writeJson(response, 200, {
        operations: await client.operations.listRecent(identity.userId),
      });
      return HANDLED;
    }

    if (
      request.method === 'GET' &&
      url.pathname === '/v1/client/canvas-resources'
    ) {
      if (!client.canvasResources) {
        writeJson(response, 503, {
          error: { code: 'CLIENT_TRANSPORT_DISABLED' },
        });
        return HANDLED;
      }
      const notebookId = gatewayOpaqueIdSchema.safeParse(
        url.searchParams.get('notebookId'),
      );
      if (!notebookId.success) {
        writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
        return HANDLED;
      }
      try {
        writeJson(response, 200, {
          resources: await client.canvasResources.list({
            trustedSubjectId: identity.userId,
            notebookId: notebookId.data,
          }),
        });
      } catch (error) {
        if (error instanceof GatewayCanvasResourceError) {
          writeJson(response, error.status, { error: { code: error.code } });
          return HANDLED;
        }
        throw error;
      }
      return HANDLED;
    }

    const canvasResourceMatch =
      request.method === 'GET'
        ? url.pathname.match(
            /^\/v1\/client\/canvas-resources\/(source|artifact)\/([^/]+)$/,
          )
        : null;
    if (canvasResourceMatch) {
      if (!client.canvasResources) {
        writeJson(response, 503, {
          error: { code: 'CLIENT_TRANSPORT_DISABLED' },
        });
        return HANDLED;
      }
      const notebookId = gatewayOpaqueIdSchema.safeParse(
        url.searchParams.get('notebookId'),
      );
      const resourceKind = canvasResourceKindSchema.safeParse(
        canvasResourceMatch[1],
      );
      let decodedResourceId: string | null = null;
      try {
        decodedResourceId = decodeURIComponent(canvasResourceMatch[2]!);
      } catch {
        // 非法 percent encoding 与其他无效选择器使用同一个 400 形状。
      }
      const resourceId = gatewayOpaqueIdSchema.safeParse(decodedResourceId);
      if (!notebookId.success || !resourceKind.success || !resourceId.success) {
        writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
        return HANDLED;
      }
      try {
        writeJson(
          response,
          200,
          await client.canvasResources.get({
            trustedSubjectId: identity.userId,
            notebookId: notebookId.data,
            resourceKind: resourceKind.data,
            resourceId: resourceId.data,
          }),
        );
      } catch (error) {
        if (error instanceof GatewayCanvasResourceError) {
          writeJson(response, error.status, { error: { code: error.code } });
          return HANDLED;
        }
        throw error;
      }
      return HANDLED;
    }

    if (request.method === 'GET' && url.pathname === '/v1/client/connections') {
      writeJson(response, 200, await client.connections.list(identity.userId));
      return HANDLED;
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
      return HANDLED;
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
      return HANDLED;
    }

    if (request.method === 'POST' && url.pathname === '/v1/client/handoffs') {
      const body = gatewayHandoffIssueRequestSchema.parse(
        await readJsonBody(request),
      );
      const token = randomBytes(32).toString('base64url');
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + HANDOFF_TTL_MS);
      await client.handoffs.issue({
        tokenDigest: createHash('sha256').update(token, 'utf8').digest('hex'),
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
      return HANDLED;
    }

    // V12：实时语音 WebSocket 握手 ticket。用短时（60 秒）单次使用的 ticket
    // 替代把长时 session bearer 放进 Sec-WebSocket-Protocol（避免长时凭证
    // 进入代理/网关/诊断日志）；Notebook 在此由服务端重新绑定校验。
    if (
      request.method === 'POST' &&
      url.pathname === '/v1/client/streaming-transcription/tickets'
    ) {
      if (!client.streamingTickets) {
        writeJson(response, 503, {
          error: { code: 'STREAMING_TRANSCRIPTION_UNAVAILABLE' },
        });
        return HANDLED;
      }
      const body = z
        .object({ notebookId: gatewayOpaqueIdSchema })
        .strict()
        .parse(await readJsonBody(request));
      if (!client.checkNotebookAccess) {
        writeJson(response, 503, {
          error: { code: 'STREAMING_TRANSCRIPTION_UNAVAILABLE' },
        });
        return HANDLED;
      }
      let allowed = false;
      try {
        allowed = await client.checkNotebookAccess({
          notebookId: body.notebookId,
          trustedSubjectId: identity.userId,
        });
      } catch {
        allowed = false;
      }
      if (!allowed) {
        // Notebook 不存在/无成员资格统一 404，不泄露差异。
        writeJson(response, 404, { error: { code: 'NOT_FOUND' } });
        return HANDLED;
      }
      writeJson(
        response,
        201,
        client.streamingTickets.issue({
          userId: identity.userId,
          notebookId: body.notebookId,
        }),
      );
      return HANDLED;
    }

    const cancelMatch =
      request.method === 'POST'
        ? url.pathname.match(
            /^\/v1\/client\/operations\/([A-Za-z0-9._:-]+)\/cancel$/,
          )
        : null;
    if (cancelMatch) {
      const result = await deps.service.requestCancel({
        operationId: cancelMatch[1]!,
        principalUserId: identity.userId,
      });
      writeJson(response, 200, result);
      return HANDLED;
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
      return HANDLED;
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
      const iterator = deps.service.handle(envelope)[Symbol.asyncIterator]();
      const first = await iterator.next();
      response.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      if (!first.done) writeEvent(response, first.value, deps.observability);
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        writeEvent(response, next.value, deps.observability);
      }
      response.end();
      return HANDLED;
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
        return HANDLED;
      }
      writeJson(response, 200, {
        events: await deps.service.resume({
          operationId: operationMatch[1]!,
          afterSequence: after,
          principalUserId: identity.userId,
        }),
      });
      return HANDLED;
    }

    return UNHANDLED;
  }

  return UNHANDLED;
}
