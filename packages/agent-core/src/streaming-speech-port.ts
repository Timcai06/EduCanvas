import type { ModelAbortSignal } from './model-contracts';

export const STREAMING_SPEECH_SAMPLE_RATE_HZ = 24_000 as const;
export const STREAMING_SPEECH_CHANNELS = 1 as const;
export const STREAMING_SPEECH_ENCODING = 'pcm_s16le' as const;

export interface StreamingSpeechRequest {
  taskAlias: 'speech.generate';
  modelAlias: 'speech';
  input: string;
  operationId: string;
  traceId: string;
  signal?: ModelAbortSignal;
}

export interface StreamingSpeechSessionRequest {
  taskAlias: 'speech.generate';
  modelAlias: 'speech';
  operationId: string;
  traceId: string;
  signal?: ModelAbortSignal;
}

export interface StreamingSpeechTextInput {
  readonly sequence: number;
  readonly input: string;
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

/**
 * One provider-neutral synthesis task. Text may be appended while the task is
 * active; callers must finish or cancel it exactly once.
 */
export interface StreamingSpeechSession {
  readonly events: AsyncIterable<StreamingSpeechEvent>;
  pushText(input: StreamingSpeechTextInput): void;
  finish(): void;
  cancel(): void;
}

/** Live Voice TTS Port；只暴露 24 kHz mono PCM 与稳定终态。 */
export interface StreamingSpeechGateway {
  beginStreaming(
    request: StreamingSpeechSessionRequest,
  ): StreamingSpeechSession;
  /** Compatibility path for bounded one-shot dictation-style callers. */
  streamSpeech(
    request: StreamingSpeechRequest,
  ): AsyncIterable<StreamingSpeechEvent>;
}
