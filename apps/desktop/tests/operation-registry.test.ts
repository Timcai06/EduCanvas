import { describe, expect, it } from 'vitest';
import { createOperationRegistry } from '../src/main/operation-registry';

describe('operation registry', () => {
  it('tracks a turn through accept/sequence/interrupted and projects pending', () => {
    const registry = createOperationRegistry();
    registry.begin('desktop:one', {
      conversationId: 'conversation:bound',
      ownerId: 7,
    });
    // 尚未收到 operation.accepted，无 operationId，不入 pending。
    expect(registry.pending()).toEqual({ operations: [] });

    registry.accept('desktop:one', 'operation:one');
    registry.recordSequence('desktop:one', 3);
    expect(registry.pending()).toEqual({
      operations: [
        {
          clientMessageId: 'desktop:one',
          operationId: 'operation:one',
          status: 'running',
          conversationId: 'conversation:bound',
        },
      ],
    });

    registry.markInterrupted('desktop:one');
    expect(registry.get('desktop:one')?.lastSequence).toBe(3);
    expect(registry.pending().operations[0]?.status).toBe('interrupted');

    registry.remove('desktop:one');
    expect(registry.get('desktop:one')).toBeUndefined();
    expect(registry.pending()).toEqual({ operations: [] });
  });

  it('ignores out-of-order sequence updates', () => {
    const registry = createOperationRegistry();
    registry.begin('desktop:two', { conversationId: null, ownerId: null });
    registry.recordSequence('desktop:two', 5);
    registry.recordSequence('desktop:two', 2);
    expect(registry.get('desktop:two')?.lastSequence).toBe(5);
  });
});
