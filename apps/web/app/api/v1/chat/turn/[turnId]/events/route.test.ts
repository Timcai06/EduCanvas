import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/identity/anonymous-identity', () => ({
  readAnonymousIdentity: vi.fn(),
}));
vi.mock('@/server/gateway/web-turn', () => ({
  resumeWebGatewayTurn: vi.fn(),
}));
vi.mock('@/server/platform/general-conversation', () => ({
  loadOwnedGeneralConversation: vi.fn(),
}));
vi.mock('@/server/platform/general-turn-persistence', () => ({
  webResearchCheckpoints: { getPublicSnapshot: vi.fn() },
}));

import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { resumeWebGatewayTurn } from '@/server/gateway/web-turn';
import { loadOwnedGeneralConversation } from '@/server/platform/general-conversation';
import { webResearchCheckpoints } from '@/server/platform/general-turn-persistence';
import { GET } from './route';

const identity = {
  token: 'token',
  studentId: `anon:v1:${'b'.repeat(64)}`,
};

const gatewayEvents = [
  {
    protocol: 'gateway.v1' as const,
    eventId: 'event-1',
    operationId: 'turn-1',
    sequence: 1,
    occurredAt: '2026-08-22T00:00:00.000Z',
    type: 'message.started' as const,
    userMessageId: 'student-1',
    assistantMessageId: 'assistant-1',
    replayed: false,
  },
  {
    protocol: 'gateway.v1' as const,
    eventId: 'event-2',
    operationId: 'turn-1',
    sequence: 2,
    occurredAt: '2026-08-22T00:00:01.000Z',
    type: 'tool.completed' as const,
    toolCallId: 'tool-1',
    summary: { secret: 'must-not-leak' },
  },
  {
    protocol: 'gateway.v1' as const,
    eventId: 'event-3',
    operationId: 'turn-1',
    sequence: 3,
    occurredAt: '2026-08-22T00:00:02.000Z',
    type: 'operation.completed' as const,
    messageId: 'assistant-1',
  },
];

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    headers: { origin: 'http://localhost', ...headers },
  });
}

function params(turnId = 'turn-1') {
  return Promise.resolve({ turnId });
}

describe('GET /api/v1/chat/turn/[turnId]/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAnonymousIdentity).mockResolvedValue(identity);
    vi.mocked(resumeWebGatewayTurn).mockResolvedValue(gatewayEvents);
    vi.mocked(loadOwnedGeneralConversation).mockResolvedValue({
      id: 'conversation-1',
    } as never);
    vi.mocked(webResearchCheckpoints.getPublicSnapshot).mockResolvedValue(null);
  });

  it('projects only bounded research progress facts', async () => {
    vi.mocked(webResearchCheckpoints.getPublicSnapshot).mockResolvedValue({
      operationId: 'turn-1',
      phase: 'reading',
      completedQueryCount: 3,
      candidateCount: 12,
      sourceCount: 5,
      citationOrdinals: [1, 2, 3],
      operationStatus: 'running',
      terminal: false,
    });

    const response = await GET(
      request('http://localhost/api/v1/chat/turn/turn-1/events?after=0'),
      { params: params() },
    );
    const body = await response.json();

    expect(body.research).toEqual({
      operationId: 'turn-1',
      phase: 'reading',
      completedQueryCount: 3,
      candidateCount: 12,
      sourceCount: 5,
      citationOrdinals: [1, 2, 3],
      operationStatus: 'running',
      terminal: false,
    });
    expect(JSON.stringify(body)).not.toContain('query');
    expect(JSON.stringify(body)).not.toContain('https://');
  });

  it('returns a public incremental batch without running a new turn', async () => {
    const response = await GET(
      request('http://localhost/api/v1/chat/turn/turn-1/events?after=0'),
      { params: params() },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(resumeWebGatewayTurn).toHaveBeenCalledWith(identity, {
      turnId: 'turn-1',
      afterSequence: 0,
      eventExtensions: [],
    });
    const body = await response.json();
    expect(body).toEqual({
      turnId: 'turn-1',
      events: [
        {
          schemaVersion: '1',
          type: 'turn.accepted',
          turnId: 'turn-1',
          sequence: 1,
          studentMessageId: 'student-1',
          assistantMessageId: 'assistant-1',
          replayed: false,
        },
        {
          schemaVersion: '1',
          type: 'tool.completed',
          turnId: 'turn-1',
          sequence: 2,
          toolCallId: 'tool-1',
        },
        {
          schemaVersion: '1',
          type: 'turn.completed',
          turnId: 'turn-1',
          sequence: 3,
          messageId: 'assistant-1',
        },
      ],
      nextSequence: 3,
      terminal: true,
    });
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
  });

  it('forwards only explicitly versioned event extensions to recovery', async () => {
    const response = await GET(
      request(
        'http://localhost/api/v1/chat/turn/turn-1/events?after=2&extension=artifact.confirmation%401',
      ),
      { params: params() },
    );

    expect(response.status).toBe(200);
    expect(resumeWebGatewayTurn).toHaveBeenCalledWith(identity, {
      turnId: 'turn-1',
      afterSequence: 2,
      eventExtensions: ['artifact.confirmation@1'],
    });
  });

  it('does not return persisted extensions to a client that did not negotiate them', async () => {
    vi.mocked(resumeWebGatewayTurn).mockRejectedValueOnce(
      Object.assign(new Error('gateway_event_extension_unavailable'), {
        code: 'CAPABILITY_UNAVAILABLE',
      }),
    );

    const response = await GET(
      request('http://localhost/api/v1/chat/turn/turn-1/events?after=99'),
      { params: params() },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'CAPABILITY_UNAVAILABLE' },
    });
  });

  it('rejects cross-origin, unauthenticated, and malformed requests', async () => {
    const crossOrigin = await GET(
      request('http://localhost/api/v1/chat/turn/turn-1/events?after=0', {
        origin: 'https://evil.example',
      }),
      { params: params() },
    );
    expect(crossOrigin.status).toBe(403);

    vi.mocked(readAnonymousIdentity).mockResolvedValueOnce(null);
    const unauthorized = await GET(
      request('http://localhost/api/v1/chat/turn/turn-1/events?after=0'),
      { params: params() },
    );
    expect(unauthorized.status).toBe(401);

    for (const query of [
      'after=-2',
      'after=01',
      'after=1000001',
      'after=0&extension=artifact.confirmation%402',
      'after=0&extension=artifact.confirmation%401&extension=artifact.confirmation%401',
    ]) {
      const malformed = await GET(
        request(`http://localhost/api/v1/chat/turn/turn-1/events?${query}`),
        { params: params() },
      );
      expect(malformed.status).toBe(400);
    }
    const malformedTurn = await GET(
      request('http://localhost/api/v1/chat/turn/not%20valid/events?after=0'),
      { params: params('not valid') },
    );
    expect(malformedTurn.status).toBe(400);
    expect(resumeWebGatewayTurn).not.toHaveBeenCalled();
  });

  it('does not reveal ownership or storage details', async () => {
    vi.mocked(resumeWebGatewayTurn).mockRejectedValue(
      Object.assign(new Error('database details'), {
        code: 'operation_not_found',
      }),
    );

    const response = await GET(
      request('http://localhost/api/v1/chat/turn/turn-1/events?after=0'),
      { params: params() },
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({
      error: { code: 'turn_not_found' },
    });
    expect(JSON.stringify(body)).not.toContain('database details');
  });
});
