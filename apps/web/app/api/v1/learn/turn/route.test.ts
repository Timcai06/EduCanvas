import { TurnRateLimitError } from '@educanvas/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/teaching/learning-turn', () => ({
  beginOwnedTeachingTurn: vi.fn(),
}));

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { beginOwnedTeachingTurn } from '@/server/teaching/learning-turn';
import { createTeachingTurnEventStream, POST } from './route';

const identity = {
  token: 'a'.repeat(43),
  studentId: `anon:v1:${'b'.repeat(64)}`,
};

function turnRequest(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/v1/learn/turn', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      ...headers,
    },
    body,
  });
}

describe('POST /api/v1/learn/turn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
  });

  it('streams accepted, delta and terminal events as named SSE frames', async () => {
    vi.mocked(beginOwnedTeachingTurn).mockResolvedValue({
      turnId: 'turn-1',
      replayed: false,
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
          type: 'message.delta' as const,
          schemaVersion: '1' as const,
          turnId: 'turn-1',
          messageId: 'assistant-1',
          delta: '你好',
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
      turnRequest(JSON.stringify({ clientMessageId: 'client-1', text: '你好' })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('event: turn.accepted');
    expect(text).toContain('event: message.delta');
    expect(text).toContain('"delta":"你好"');
    expect(text).toContain('event: turn.completed');
  });

  it('rejects requests without an owned anonymous identity', async () => {
    vi.mocked(readAnonymousIdentity).mockResolvedValue(null);
    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'client-1', text: '你好' })),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'unauthorized' },
    });
  });

  it('maps durable rate limiting to 429 with retry metadata', async () => {
    vi.mocked(beginOwnedTeachingTurn).mockRejectedValue(
      new TurnRateLimitError(1_250),
    );
    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'client-1', text: '你好' })),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('2');
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'turn_rate_limited', retryAfterMs: 1_250 },
    });
  });

  it('rejects cross-origin writes before parsing or starting a turn', async () => {
    const response = await POST(
      turnRequest(
        JSON.stringify({ clientMessageId: 'client-1', text: '你好' }),
        { origin: 'https://evil.example' },
      ),
    );
    expect(response.status).toBe(403);
    expect(beginOwnedTeachingTurn).not.toHaveBeenCalled();
  });

  it('does not expose unexpected server errors', async () => {
    vi.mocked(beginOwnedTeachingTurn).mockRejectedValue(
      new Error('DATABASE_URL=postgres://secret'),
    );
    const response = await POST(
      turnRequest(JSON.stringify({ clientMessageId: 'client-1', text: '你好' })),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('postgres://secret');
  });
});

describe('createTeachingTurnEventStream', () => {
  it('keeps consuming the durable turn after the browser disconnects', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completedInBackground = false;
    const stream = createTeachingTurnEventStream(
      (async function* () {
        yield {
          type: 'turn.accepted' as const,
          schemaVersion: '1' as const,
          turnId: 'turn-1',
          studentMessageId: 'student-1',
          assistantMessageId: 'assistant-1',
          replayed: false,
        };
        await gate;
        completedInBackground = true;
        yield {
          type: 'turn.completed' as const,
          schemaVersion: '1' as const,
          turnId: 'turn-1',
          messageId: 'assistant-1',
        };
      })(),
    );
    const reader = stream.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    release();
    await vi.waitFor(() => expect(completedInBackground).toBe(true));
  });
});
