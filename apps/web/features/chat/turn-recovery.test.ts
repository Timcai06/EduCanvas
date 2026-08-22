import { describe, expect, it, vi } from 'vitest';
import {
  parseTurnEventsRecoveryResponse,
  TurnRecoveryController,
  TurnRecoveryProtocolError,
} from './turn-recovery';

const accepted = (sequence = 0) => ({
  type: 'turn.accepted' as const,
  schemaVersion: '1' as const,
  turnId: 'turn-1',
  studentMessageId: 'student-1',
  assistantMessageId: 'assistant-1',
  replayed: true,
  sequence,
});

const completed = (sequence = 1) => ({
  type: 'turn.completed' as const,
  schemaVersion: '1' as const,
  turnId: 'turn-1',
  messageId: 'assistant-1',
  sequence,
});

describe('turn recovery protocol', () => {
  it('strictly parses the small envelope and preserves event sequence', () => {
    const result = parseTurnEventsRecoveryResponse({
      events: [accepted(3)],
      nextSequence: 3,
      terminal: false,
    });

    expect(result.events[0]).toMatchObject({
      type: 'turn.accepted',
      sequence: 3,
    });
    expect(() =>
      parseTurnEventsRecoveryResponse({
        events: [{ ...accepted(), type: 'unknown.event' }],
        nextSequence: 1,
        terminal: false,
      }),
    ).toThrow(TurnRecoveryProtocolError);
    expect(() =>
      parseTurnEventsRecoveryResponse({
        events: [],
        nextSequence: -1,
        terminal: false,
      }),
    ).toThrow(TurnRecoveryProtocolError);
  });

  it('strictly parses the optional aggregate research snapshot', () => {
    const result = parseTurnEventsRecoveryResponse({
      events: [],
      nextSequence: 4,
      terminal: false,
      research: {
        phase: 'reading',
        completedQueryCount: 3,
        candidateCount: 9,
        sourceCount: 4,
        citationOrdinals: [1, 3, 5],
        operationStatus: 'running',
        terminal: false,
      },
    });
    expect(result.research).toMatchObject({
      phase: 'reading',
      completedQueryCount: 3,
      citationOrdinals: [1, 3, 5],
    });
    expect(() =>
      parseTurnEventsRecoveryResponse({
        events: [],
        nextSequence: 4,
        terminal: false,
        research: {
          phase: 'planning',
          completedQueryCount: 6,
          candidateCount: 0,
          sourceCount: 0,
          citationOrdinals: [],
          operationStatus: 'running',
          terminal: false,
        },
      }),
    ).toThrow(TurnRecoveryProtocolError);
  });

  it('polls one existing turn with the response cursor until terminal', async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json({
          events: [accepted(1)],
          nextSequence: 1,
          terminal: false,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          events: [completed(2)],
          nextSequence: 2,
          terminal: true,
        }),
      );
    const sleep = vi.fn(async () => undefined);
    const events: string[] = [];
    const controller = new TurnRecoveryController({
      eventsEndpoint: (turnId) => `/api/v1/chat/turn/${turnId}/events`,
      fetchImpl,
      retryDelaysMs: [1],
      maxAttempts: 3,
      sleep,
    });

    const result = await controller.recover(
      'turn-1',
      0,
      (event) => events.push(event.type),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ nextSequence: 2, terminal: true });
    expect(events).toEqual(['turn.accepted', 'turn.completed']);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/chat/turn/turn-1/events?after=0',
      '/api/v1/chat/turn/turn-1/events?after=1',
    ]);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('keeps empty non-terminal batches bounded', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ events: [], nextSequence: 0, terminal: false }),
    );
    const controller = new TurnRecoveryController({
      eventsEndpoint: () => '/events',
      fetchImpl,
      maxAttempts: 3,
      sleep: vi.fn(async () => undefined),
    });

    await expect(
      controller.recover(
        'turn-1',
        0,
        () => undefined,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ attempts: 3, terminal: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
