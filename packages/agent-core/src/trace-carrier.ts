import { z } from 'zod';

const traceparentPattern =
  /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-0[01]$/;

/**
 * 跨进程恢复只允许W3C Trace Context的最小传播字段。
 * 不接受baggage、tracestate、业务正文或任意扩展字段。
 */
export const w3cTraceCarrierSchema = z
  .object({
    traceparent: z.string().regex(traceparentPattern),
  })
  .strict();

export type W3cTraceCarrier = z.infer<typeof w3cTraceCarrierSchema>;
