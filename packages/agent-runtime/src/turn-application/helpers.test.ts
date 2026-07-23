import { describe, expect, it } from 'vitest';
import { startTraceSafely } from './helpers';
import type { TurnApplicationTracePort } from './ports';

const startInput: Parameters<TurnApplicationTracePort['start']>[0] = {
  operationId: 'operation:1',
  traceId: 'trace:1',
  actorId: 'actor:1',
  agentId: 'agent:1',
  notebookId: 'notebook:1',
  conversationId: 'conversation:1',
  profileId: 'general.default',
  entrypoint: 'web',
};

describe('Turn trace安全降级', () => {
  it('传递严格W3C carrier', () => {
    const traceCarrier = {
      traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
    } as const;
    const span = startTraceSafely(
      {
        start: () => ({
          carrier: () => traceCarrier,
          event() {},
          end() {},
        }),
      },
      startInput,
    );
    expect(span.carrier()).toEqual(traceCarrier);
  });

  it('carrier抛错或返回越界字段时降级为null', () => {
    const throwing = startTraceSafely(
      {
        start: () => ({
          carrier() {
            throw new Error('exporter_unavailable');
          },
          event() {},
          end() {},
        }),
      },
      startInput,
    );
    expect(throwing.carrier()).toBeNull();

    const invalid = startTraceSafely(
      {
        start: () =>
          ({
            carrier: () => ({
              traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
              baggage: 'private=value',
            }),
            event() {},
            end() {},
          }) as never,
      },
      startInput,
    );
    expect(invalid.carrier()).toBeNull();
  });
});
