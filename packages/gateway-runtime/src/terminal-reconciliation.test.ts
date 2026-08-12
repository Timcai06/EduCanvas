import { describe, expect, it } from 'vitest';
import {
  decideGatewayTerminalReconciliation,
  gatewayTerminalReconciliationKey,
  type GatewayTerminalConsistencySnapshot,
} from './terminal-reconciliation';

const base: GatewayTerminalConsistencySnapshot = {
  operationId: 'operation:1',
  settlementIntent: null,
  operationStatus: 'running',
  terminalEvent: null,
};

describe('Gateway terminal reconciliation contract', () => {
  it('does not invent a terminal while both durable facts are active', () => {
    expect(decideGatewayTerminalReconciliation(base)).toEqual({
      action: 'pending',
    });
  });

  it('appends the missing Operation terminal from a settled assistant', () => {
    expect(
      decideGatewayTerminalReconciliation({
        ...base,
        settlementIntent: {
          status: 'completed',
          messageId: 'message:assistant:1',
        },
      }),
    ).toEqual({
      action: 'append_operation_terminal',
      terminal: {
        status: 'completed',
        messageId: 'message:assistant:1',
      },
    });
  });

  it('settles the missing assistant from the persisted terminal event', () => {
    expect(
      decideGatewayTerminalReconciliation({
        ...base,
        operationStatus: 'cancelled',
        terminalEvent: { status: 'cancelled' },
      }),
    ).toEqual({
      action: 'settle_assistant',
      terminal: { status: 'cancelled' },
    });
  });

  it('treats an identical replay as already consistent', () => {
    const terminal = {
      status: 'failed' as const,
      code: 'RUNTIME_FAILED' as const,
      retryable: true,
    };
    expect(
      decideGatewayTerminalReconciliation({
        ...base,
        settlementIntent: terminal,
        operationStatus: 'failed',
        terminalEvent: terminal,
      }),
    ).toEqual({ action: 'consistent', terminal });
  });

  it('fails closed instead of overwriting conflicting terminal facts', () => {
    expect(
      decideGatewayTerminalReconciliation({
        ...base,
        settlementIntent: {
          status: 'completed',
          messageId: 'message:assistant:1',
        },
        operationStatus: 'failed',
        terminalEvent: {
          status: 'failed',
          code: 'RUNTIME_FAILED',
          retryable: true,
        },
      }),
    ).toEqual({
      action: 'conflict',
      reason: 'assistant_operation_terminal_mismatch',
    });
  });

  it('rejects a terminal Operation without its atomic terminal event', () => {
    expect(
      decideGatewayTerminalReconciliation({
        ...base,
        operationStatus: 'completed',
      }),
    ).toEqual({
      action: 'conflict',
      reason: 'operation_terminal_without_event',
    });
  });

  it('uses an Operation-scoped key without terminal content', () => {
    expect(gatewayTerminalReconciliationKey('operation:1')).toBe(
      'gateway-terminal-reconciliation-v1:operation:1',
    );
  });
});
