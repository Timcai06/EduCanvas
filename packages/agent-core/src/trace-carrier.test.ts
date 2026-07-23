import { describe, expect, it } from 'vitest';
import { w3cTraceCarrierSchema } from './trace-carrier';

const validTraceId = 'a'.repeat(32);
const validSpanId = 'b'.repeat(16);

describe('W3C trace carrier contract', () => {
  it('只接受version 00、非零ID与01/00 flags', () => {
    for (const flags of ['00', '01']) {
      expect(
        w3cTraceCarrierSchema.safeParse({
          traceparent: `00-${validTraceId}-${validSpanId}-${flags}`,
        }).success,
      ).toBe(true);
    }
    for (const traceparent of [
      `01-${validTraceId}-${validSpanId}-01`,
      `00-${'0'.repeat(32)}-${validSpanId}-01`,
      `00-${validTraceId}-${'0'.repeat(16)}-01`,
      `00-${validTraceId.toUpperCase()}-${validSpanId}-01`,
      `00-${validTraceId}-${validSpanId}-02`,
    ]) {
      expect(w3cTraceCarrierSchema.safeParse({ traceparent }).success).toBe(
        false,
      );
    }
  });

  it('拒绝tracestate、baggage和任意扩展字段', () => {
    for (const extension of [
      { tracestate: 'vendor=value' },
      { baggage: 'student=private' },
      { prompt: '不得进入carrier' },
    ]) {
      expect(
        w3cTraceCarrierSchema.safeParse({
          traceparent: `00-${validTraceId}-${validSpanId}-01`,
          ...extension,
        }).success,
      ).toBe(false);
    }
  });
});
