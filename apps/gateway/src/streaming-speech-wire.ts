import { z } from 'zod';

const sequenceSchema = z.number().int().min(0).max(1_000_000);

export const streamingSpeechClientMessageSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('speech.start'), sequence: sequenceSchema })
    .strict(),
  z
    .object({
      type: z.literal('speech.submit'),
      sequence: sequenceSchema,
      text: z.string().trim().min(1).max(20_000),
    })
    .strict(),
  z
    .object({ type: z.literal('speech.finish'), sequence: sequenceSchema })
    .strict(),
  z
    .object({ type: z.literal('speech.cancel'), sequence: sequenceSchema })
    .strict(),
]);

export type StreamingSpeechClientMessage = z.infer<
  typeof streamingSpeechClientMessageSchema
>;

export type StreamingSpeechServerMessage =
  | {
      readonly type: 'speech.started';
      readonly format: 'pcm_s16le';
      readonly sampleRate: 24_000;
      readonly channels: 1;
    }
  | { readonly type: 'speech.finished' }
  | {
      readonly type: 'speech.failed';
      readonly failureCode:
        | 'MODEL_FAILED'
        | 'CANCELLED'
        | 'INVALID_REQUEST'
        | 'BACKPRESSURE_EXCEEDED';
    };

export function decodeStreamingSpeechClientMessage(
  raw: string,
): StreamingSpeechClientMessage | null {
  if (Buffer.byteLength(raw, 'utf8') > 80_000) return null;
  try {
    const parsed = streamingSpeechClientMessageSchema.safeParse(
      JSON.parse(raw),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const AUDIO_MAGIC = 0x45445453; // EDTS
const AUDIO_HEADER_BYTES = 8;

/** Server-only PCM frame: fixed magic + uint32 sequence + even PCM16LE bytes. */
export function encodeStreamingSpeechAudioFrame(
  sequence: number,
  pcmBytes: Uint8Array,
): Uint8Array | null {
  if (
    !Number.isInteger(sequence) ||
    sequence < 0 ||
    sequence > 0xffff_ffff ||
    pcmBytes.byteLength === 0 ||
    pcmBytes.byteLength % 2 !== 0
  ) {
    return null;
  }
  const frame = new Uint8Array(AUDIO_HEADER_BYTES + pcmBytes.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, AUDIO_MAGIC, false);
  view.setUint32(4, sequence, false);
  frame.set(pcmBytes, AUDIO_HEADER_BYTES);
  return frame;
}
