import {
  AssetAccessError,
  MessagePartValidationError,
  PlatformMessageIdConflictError,
  PlatformTurnInProgressError,
  PlatformTurnOwnershipError,
} from '@educanvas/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/gateway/web-turn', () => ({
  beginWebGatewayTurn: vi.fn(),
}));

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { beginWebGatewayTurn } from '@/server/gateway/web-turn';
import { TurnRequestValidationError } from '@/server/http/turn-request';
import { UnsupportedAssetModalityError } from '@/server/assets/asset-materialization';
import { POST } from './route';

const identity = {
  token: 'token',
  studentId: `anon:v1:${'b'.repeat(64)}`,
};

function turnRequest(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/v1/chat/turn', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      ...headers,
    },
    body,
  });
}

describe('POST /api/v1/chat/turn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
  });

  it('streams accepted turns as SSE', async () => {
    vi.mocked(beginWebGatewayTurn).mockResolvedValue({
      events: (async function* () {
        yield {
          type: 'turn.accepted' as const,
          schemaVersion: '1' as const,
          turnId: 'turn-1',
          studentMessageId: 'student-1',
          assistantMessageId: 'assistant-1',
          replayed: false,
        };
        yield {
          type: 'turn.completed' as const,
          schemaVersion: '1' as const,
          turnId: 'turn-1',
          messageId: 'assistant-1',
        };
      })(),
    });

    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: '你好' })),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('event: turn.accepted');
    expect(text).toContain('event: turn.completed');
  });

  it('forbids cross-origin writes before parsing payload', async () => {
    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: 'hi' }), {
        origin: 'https://evil.example',
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'forbidden_origin' },
    });
    expect(beginWebGatewayTurn).not.toHaveBeenCalled();
  });

  it('rejects missing anonymous identity', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValue(null);

    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: 'hi' })),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized' },
    });
    expect(beginWebGatewayTurn).not.toHaveBeenCalled();
  });

  it('maps invalid content type to 415', async () => {
    const response = await POST(
      turnRequest('{"clientMessageId":"msg-1","text":"hi"}', {
        'content-type': 'text/plain',
      }),
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_content_type' },
    });
  });

  it('maps turn request parse failures to 400', async () => {
    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: '   ' })),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    });
  });

  it('maps message-id conflicts to 409', async () => {
    vi.mocked(beginWebGatewayTurn).mockRejectedValue(
      new PlatformMessageIdConflictError(),
    );

    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: 'hi' })),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'message_id_conflict' },
    });
  });

  it('maps in-progress turns to 409', async () => {
    vi.mocked(beginWebGatewayTurn).mockRejectedValue(
      new PlatformTurnInProgressError('turn-1'),
    );

    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: 'hi' })),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'turn_in_progress' },
    });
  });

  it('maps missing conversation to 404', async () => {
    vi.mocked(beginWebGatewayTurn).mockRejectedValue(
      new PlatformTurnOwnershipError(),
    );

    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: 'hi' })),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'conversation_not_found' },
    });
  });

  it('maps asset-related errors to 422', async () => {
    vi.mocked(beginWebGatewayTurn).mockRejectedValueOnce(new AssetAccessError());

    const responseA = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: 'hi' })),
    );

    vi.mocked(beginWebGatewayTurn).mockRejectedValueOnce(
      new MessagePartValidationError('bad parts'),
    );
    const responseB = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: 'hi' })),
    );

    expect(responseA.status).toBe(422);
    expect(responseB.status).toBe(422);
    await expect(responseA.json()).resolves.toMatchObject({
      error: { code: 'asset_not_available' },
    });
    await expect(responseB.json()).resolves.toMatchObject({
      error: { code: 'asset_not_available' },
    });
  });

  it('maps modality mismatch to 422 with provider code', async () => {
    vi.mocked(beginWebGatewayTurn).mockRejectedValue(
      new UnsupportedAssetModalityError(['image']),
    );

    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: 'hi' })),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unsupported_asset_modality' },
    });
  });

  it('does not leak internal exception text and returns 503 on unknown errors', async () => {
    vi.mocked(beginWebGatewayTurn).mockRejectedValue(
      new TurnRequestValidationError('invalid_json'),
    );

    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-1', text: 'hi' })),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.not.toContain('invalid_json');

    vi.mocked(beginWebGatewayTurn).mockRejectedValue(
      new Error('DATABASE_URL=postgres://secret'),
    );
    const unavailable = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'msg-2', text: 'hi' })),
    );

    expect(unavailable.status).toBe(503);
    await expect(unavailable.text()).resolves.not.toContain(
      'postgres://secret',
    );
  });
});
