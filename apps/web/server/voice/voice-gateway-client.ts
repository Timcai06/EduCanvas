import 'server-only';

import { z } from 'zod';

const gatewayGrantSchema = z
  .object({
    userId: z.string().min(1).max(256),
    token: z.string().min(1).max(4_096),
    expiresAt: z.string().datetime(),
  })
  .passthrough();

const ticketGrantSchema = z
  .object({
    ticket: z.string().min(1).max(4_096),
    expiresAt: z.string().datetime(),
  })
  .strict();

export class VoiceGatewayError extends Error {
  override readonly name = 'VoiceGatewayError';
  constructor(
    readonly code:
      | 'VOICE_GATEWAY_NOT_CONFIGURED'
      | 'VOICE_GATEWAY_UNAVAILABLE'
      | 'VOICE_GATEWAY_REJECTED'
      | 'VOICE_GATEWAY_RESOURCE_NOT_FOUND',
  ) {
    super(code);
  }
}

export interface VoiceGatewayClientOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

function readConfiguration(env: NodeJS.ProcessEnv): {
  baseUrl: URL;
  bootstrapToken: string;
} {
  const rawUrl = env.EDUCANVAS_GATEWAY_URL?.trim();
  const bootstrapToken = env.EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN?.trim();
  if (!rawUrl || !bootstrapToken || Buffer.byteLength(bootstrapToken) < 32) {
    throw new VoiceGatewayError('VOICE_GATEWAY_NOT_CONFIGURED');
  }
  try {
    const baseUrl = new URL(rawUrl);
    if (
      !['http:', 'https:'].includes(baseUrl.protocol) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      throw new Error('invalid');
    }
    return { baseUrl, bootstrapToken };
  } catch {
    throw new VoiceGatewayError('VOICE_GATEWAY_NOT_CONFIGURED');
  }
}

async function postJson(
  fetchImpl: typeof fetch,
  url: URL,
  authorization: string,
  body: unknown,
  notFoundCode?: VoiceGatewayError['code'],
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authorization}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new VoiceGatewayError('VOICE_GATEWAY_UNAVAILABLE');
  }
  if (!response.ok) {
    response.body?.cancel().catch(() => undefined);
    // Gateway 用 404 统一表达资源不存在与主体无权访问。这里只保留该稳定、
    // 不泄露归属差异的语义；其他下游响应体仍不穿过 model/BFF 信任边界。
    if (response.status === 404 && notFoundCode) {
      throw new VoiceGatewayError(notFoundCode);
    }
    throw new VoiceGatewayError('VOICE_GATEWAY_REJECTED');
  }
  try {
    return await response.json();
  } catch {
    throw new VoiceGatewayError('VOICE_GATEWAY_REJECTED');
  }
}

/** Web session 主体换取一次性 WS ticket；长时 bearer 永不返回浏览器。 */
export async function issueVoiceStreamingTicket(
  input: { subjectUserId: string; notebookId: string },
  options: VoiceGatewayClientOptions = {},
): Promise<{ ticket: string; expiresAt: string }> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const { baseUrl, bootstrapToken } = readConfiguration(env);
  const session = gatewayGrantSchema.parse(
    await postJson(
      fetchImpl,
      new URL('/v1/client/bootstrap', baseUrl),
      bootstrapToken,
      { userId: input.subjectUserId },
    ),
  );
  if (session.userId !== input.subjectUserId) {
    throw new VoiceGatewayError('VOICE_GATEWAY_REJECTED');
  }
  return ticketGrantSchema.parse(
    await postJson(
      fetchImpl,
      new URL('/v1/client/streaming-transcription/tickets', baseUrl),
      session.token,
      { notebookId: input.notebookId },
      'VOICE_GATEWAY_RESOURCE_NOT_FOUND',
    ),
  );
}
