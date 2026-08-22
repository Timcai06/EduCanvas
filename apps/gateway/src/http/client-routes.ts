import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  gatewayCapabilityDefaultRisk,
  gatewayCapabilityDefaultVersion,
  gatewayClientTurnRequestSchema,
  gatewayConversationCreateRequestSchema,
  gatewayConnectionConnectRequestSchema,
  gatewayConnectionRevokeRequestSchema,
  gatewayHandoffCredentialSchema,
  gatewayHandoffIssueRequestSchema,
  gatewayOpaqueIdSchema,
  gatewayProtocolVersion,
  type GatewayCapabilityManifest,
  type GatewayClientTurnRequest,
  type GatewayInboundEnvelope,
} from '@educanvas/gateway-core';
import { canvasResourceKindSchema } from '@educanvas/canvas-protocol';
import { ZodError, z } from 'zod';
import { readBearerToken } from '../client-auth';
import { GatewayCanvasResourceError } from '../canvas-resource-service';
import { GatewayImagePreviewError } from '../asset-image-preview-service';
import { handleAssetRoutes } from './asset-routes';
import { handleDesktopRevoke, resolveClientAuth } from './client-request-auth';
import {
  decodeConversationDirectoryCursor,
  encodeConversationDirectoryCursor,
} from './conversation-directory-cursor';
import {
  decodeMessageHistoryCursor,
  encodeMessageHistoryCursor,
} from './message-history-cursor';
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
 * 把客户端声明的能力名解析为服务端受控的 capability manifest（DP06）。
 * risk/version 只来自服务端 `gatewayCapabilityDefaultRisk` 表；未知能力名抛 ZodError
 * 走统一 400 INVALID_REQUEST，避免客户端自报 L2/L3 或探测未登记能力。
 */
function resolveClientCapabilityManifest(
  body: GatewayClientTurnRequest,
  issuedAt: string,
): GatewayCapabilityManifest {
  const capabilities = body.capabilities.capabilities.map((name) => {
    const risk = gatewayCapabilityDefaultRisk[name];
    if (!risk) {
      throw new ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: ['capabilities', 'capabilities'],
          message: `Unsupported capability: ${name}`,
        },
      ]);
    }
    return {
      name,
      risk,
      version: gatewayCapabilityDefaultVersion,
      constraints: {},
    };
  });
  return {
    manifestId: `client:${body.clientMessageId}`,
    issuedAt,
    capabilities,
  };
}

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
    if ((await handleAssetRoutes(ctx, client, identity)).handled) {
      return HANDLED;
    }

    if (
      request.method === 'GET' &&
      url.pathname === '/v1/client/conversations'
    ) {
      if (!client.directory.listConversationPage) {
        writeJson(response, 503, {
          error: { code: 'CLIENT_TRANSPORT_DISABLED' },
        });
        return HANDLED;
      }
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? 30 : Number(rawLimit);
      const rawCursor = url.searchParams.get('cursor');
      const cursor = rawCursor
        ? decodeConversationDirectoryCursor(rawCursor)
        : null;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        (rawCursor !== null && cursor === null)
      ) {
        writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
        return HANDLED;
      }
      const page = await client.directory.listConversationPage({
        userId: identity.userId,
        limit,
        cursor,
      });
      writeJson(response, 200, {
        schemaVersion: 1,
        conversations: page.items,
        nextCursor: page.nextCursor
          ? encodeConversationDirectoryCursor(page.nextCursor)
          : null,
      });
      return HANDLED;
    }

    if (
      request.method === 'POST' &&
      url.pathname === '/v1/client/conversations'
    ) {
      if (!client.directory.createConversation) {
        writeJson(response, 503, {
          error: { code: 'CLIENT_TRANSPORT_DISABLED' },
        });
        return HANDLED;
      }
      const body = gatewayConversationCreateRequestSchema.parse(
        await readJsonBody(request),
      );
      const conversation = await client.directory.createConversation({
        userId: identity.userId,
        notebookId: body.notebookId,
        title: body.title,
      });
      writeJson(response, 201, { schemaVersion: 1, conversation });
      return HANDLED;
    }

    const messageHistoryMatch =
      request.method === 'GET'
        ? url.pathname.match(/^\/v1\/client\/conversations\/([^/]+)\/messages$/)
        : null;
    if (messageHistoryMatch) {
      if (!client.messageHistory) {
        writeJson(response, 503, {
          error: { code: 'CLIENT_TRANSPORT_DISABLED' },
        });
        return HANDLED;
      }
      const conversationId = gatewayOpaqueIdSchema.safeParse(
        decodeURIComponent(messageHistoryMatch[1]!),
      );
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? 30 : Number(rawLimit);
      const rawCursor = url.searchParams.get('cursor');
      const cursor = rawCursor ? decodeMessageHistoryCursor(rawCursor) : null;
      if (
        !conversationId.success ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (rawCursor !== null && cursor === null)
      ) {
        writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
        return HANDLED;
      }
      const page = await client.messageHistory.listMessagePage({
        conversationId: conversationId.data,
        trustedSubjectId: identity.userId,
        limit,
        cursor,
      });
      writeJson(response, 200, {
        schemaVersion: 1,
        messages: page.items,
        nextCursor: page.nextCursor
          ? encodeMessageHistoryCursor(page.nextCursor)
          : null,
      });
      return HANDLED;
    }

    const imagePreviewMatch =
      request.method === 'GET'
        ? url.pathname.match(
            /^\/v1\/client\/conversations\/([^/]+)\/assets\/([^/]+)\/versions\/([^/]+)\/image-preview$/,
          )
        : null;
    if (imagePreviewMatch) {
      if (!client.imagePreviews) {
        writeJson(response, 503, {
          error: { code: 'CLIENT_TRANSPORT_DISABLED' },
        });
        return HANDLED;
      }
      const selectors = imagePreviewMatch.slice(1).map((value) => {
        try {
          return gatewayOpaqueIdSchema.safeParse(decodeURIComponent(value!));
        } catch {
          return gatewayOpaqueIdSchema.safeParse(null);
        }
      });
      const [conversationId, assetId, assetVersionId] = selectors;
      if (
        !conversationId?.success ||
        !assetId?.success ||
        !assetVersionId?.success
      ) {
        writeJson(response, 400, { error: { code: 'INVALID_REQUEST' } });
        return HANDLED;
      }
      try {
        const preview = await client.imagePreviews.read({
          conversationId: conversationId.data,
          trustedSubjectId: identity.userId,
          assetId: assetId.data,
          assetVersionId: assetVersionId.data,
        });
        response.writeHead(200, {
          'content-type': preview.mimeType,
          'content-length': preview.bytes.byteLength,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        });
        response.end(preview.bytes);
      } catch (error) {
        if (error instanceof GatewayImagePreviewError) {
          writeJson(response, error.status, { error: { code: error.code } });
          return HANDLED;
        }
        throw error;
      }
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
        ...(body.target ? { target: body.target } : {}),
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
    // 60 秒单次 ticket 隔离长时 bearer；Notebook 仍由服务端重验。
    const voiceTicketScope =
      url.pathname === '/v1/client/streaming-transcription/tickets'
        ? 'transcription'
        : url.pathname === '/v1/client/streaming-speech/tickets'
          ? 'speech'
          : null;
    if (request.method === 'POST' && voiceTicketScope !== null) {
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
      let allowed: boolean;
      try {
        allowed = await client.checkNotebookAccess({
          notebookId: body.notebookId,
          trustedSubjectId: identity.userId,
        });
      } catch {
        allowed = false;
      }
      if (!allowed) {
        writeJson(response, 404, { error: { code: 'NOT_FOUND' } });
        return HANDLED;
      }
      writeJson(
        response,
        201,
        client.streamingTickets.issue({
          userId: identity.userId,
          notebookId: body.notebookId,
          scope: voiceTicketScope,
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
          transport: 'desktop',
          adapterId: 'educanvas.desktop',
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
        capabilities: resolveClientCapabilityManifest(body, now),
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
