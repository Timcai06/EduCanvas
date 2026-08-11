import { z } from 'zod';

const dashScopeHeaderSchema = z
  .object({
    task_id: z.string().uuid(),
    event: z.enum([
      'task-started',
      'result-generated',
      'task-finished',
      'task-failed',
    ]),
  })
  .passthrough();

const dashScopeEnvelopeSchema = z
  .object({
    header: dashScopeHeaderSchema,
    payload: z.unknown().optional(),
  })
  .passthrough();

const dashScopeTranscriptionResultSchema = z
  .object({
    header: dashScopeHeaderSchema.extend({
      event: z.literal('result-generated'),
    }),
    payload: z
      .object({
        output: z
          .object({
            sentence: z
              .object({
                text: z.string(),
                heartbeat: z.boolean().optional(),
                sentence_end: z.boolean(),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export type DashScopeEnvelope = z.infer<typeof dashScopeEnvelopeSchema>;
export type DashScopeTranscriptionResult = z.infer<
  typeof dashScopeTranscriptionResultSchema
>;

function decodeTextFrame(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString(
      'utf8',
    );
  }
  if (Array.isArray(raw) && raw.every((part) => Buffer.isBuffer(part))) {
    return Buffer.concat(raw).toString('utf8');
  }
  return null;
}

/** Provider 文本帧先收敛为闭集 envelope；解析失败时不得产生领域事件。 */
export function parseDashScopeEnvelope(raw: unknown): DashScopeEnvelope | null {
  const text = decodeTextFrame(raw);
  if (text === null || Buffer.byteLength(text, 'utf8') > 1_048_576) return null;
  try {
    const parsed = dashScopeEnvelopeSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseDashScopeTranscriptionResult(
  envelope: DashScopeEnvelope,
): DashScopeTranscriptionResult | null {
  const parsed = dashScopeTranscriptionResultSchema.safeParse(envelope);
  return parsed.success ? parsed.data : null;
}

/** 复制二进制帧，避免把 Provider/`ws` 的可变 Buffer 暴露给领域层。 */
export function copyDashScopeBinaryFrame(raw: unknown): Uint8Array | null {
  let bytes: Buffer;
  if (raw instanceof ArrayBuffer) bytes = Buffer.from(raw);
  else if (ArrayBuffer.isView(raw)) {
    bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  } else if (Array.isArray(raw) && raw.every((part) => Buffer.isBuffer(part))) {
    bytes = Buffer.concat(raw);
  } else return null;
  if (bytes.byteLength === 0 || bytes.byteLength > 1_048_576) return null;
  return Uint8Array.from(bytes);
}
