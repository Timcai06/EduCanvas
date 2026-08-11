import type { ModelAbortSignal } from './model-contracts';

export const STREAMING_SPEECH_SAMPLE_RATE_HZ = 24_000 as const;
export const STREAMING_SPEECH_CHANNELS = 1 as const;
export const STREAMING_SPEECH_ENCODING = 'pcm_s16le' as const;

export interface StreamingSpeechRequest {
  taskAlias: 'speech.synthesize';
  modelAlias: 'speech';
  input: string;
  operationId: string;
  traceId: string;
  signal?: ModelAbortSignal;
}

export type StreamingSpeechEvent =
  | {
      readonly type: 'audio';
      readonly sequence: number;
      readonly pcmBytes: Uint8Array;
    }
  | { readonly type: 'finished' }
  | {
      readonly type: 'failed';
      readonly failureCode: 'MODEL_FAILED' | 'CANCELLED';
    };

/** Live Voice TTS Port；只暴露 24 kHz mono PCM 与稳定终态。 */
export interface StreamingSpeechGateway {
  streamSpeech(
    request: StreamingSpeechRequest,
  ): AsyncIterable<StreamingSpeechEvent>;
}
