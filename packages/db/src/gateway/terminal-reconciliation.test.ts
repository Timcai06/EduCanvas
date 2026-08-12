import { describe, expect, it } from 'vitest';
import {
  encodeGatewayTerminalIntent,
  parseGatewayTerminalIntent,
  type DurableGatewayTerminalIntent,
} from './terminal-reconciliation';

const messageId = '00000000-0000-4000-8000-000000000001';

describe('Gateway terminal intent codec', () => {
  it.each<DurableGatewayTerminalIntent>([
    { status: 'completed', messageId },
    { status: 'failed', code: 'RUNTIME_FAILED', retryable: true },
    { status: 'failed', code: 'POLICY_BLOCKED', retryable: false },
    { status: 'cancelled' },
  ])('只往返封闭的安全终态字段：$status', (intent) => {
    const encoded = encodeGatewayTerminalIntent(intent);

    expect(parseGatewayTerminalIntent(encoded)).toEqual(intent);
    expect(encoded).not.toContain('prompt');
    expect(encoded).not.toContain('provider');
    expect(encoded).not.toContain('stack');
    expect(encoded).not.toContain('secret');
  });

  it.each([
    null,
    '',
    'ordinary_failure_code',
    'gateway_terminal_intent_v1',
    'gateway_terminal_intent_v1:completed:not-a-uuid',
    `gateway_terminal_intent_v1:completed:${messageId}:extra`,
    'gateway_terminal_intent_v1:failed:PRIVATE_PROVIDER_BODY:1',
    'gateway_terminal_intent_v1:failed:RUNTIME_FAILED:true',
    'gateway_terminal_intent_v1:failed:RUNTIME_FAILED:1:secret=key',
    'gateway_terminal_intent_v1:cancelled:raw-body',
    'gateway_terminal_intent_v1:unknown:stack-trace',
  ])('拒绝畸形、扩展和疑似敏感载荷：%s', (encoded) => {
    expect(parseGatewayTerminalIntent(encoded)).toBeNull();
  });
});
