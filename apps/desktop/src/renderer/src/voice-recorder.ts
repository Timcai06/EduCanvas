import { createVoiceVad, selectVoiceRecordingMimeType } from './voice-vad';

export interface StreamLike {
  getTracks(): Array<{ stop(): void }>;
}

export interface RecorderLike {
  state: 'inactive' | 'recording' | 'paused';
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

export interface LevelMonitor {
  stop(): void;
}

export interface VoiceRecorderDependencies {
  getUserMedia(): Promise<StreamLike>;
  isTypeSupported(mimeType: string): boolean;
  createRecorder(stream: StreamLike, mimeType: string): RecorderLike;
  createLevelMonitor(
    stream: StreamLike,
    onSample: (level: number, nowMs: number) => void,
  ): LevelMonitor;
}

export type VoiceRecorderFailureCode =
  | 'aborted'
  | 'permission_denied'
  | 'no_input'
  | 'unsupported'
  | 'no_speech'
  | 'capture_failed';

export type VoiceRecordingResult =
  | {
      ok: true;
      recording: { bytes: Uint8Array; mimeType: 'audio/webm' };
    }
  | { ok: false; code: VoiceRecorderFailureCode };

function browserDependencies(): VoiceRecorderDependencies {
  return {
    getUserMedia: () =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
    isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
    createRecorder: (stream, mimeType) => {
      const nativeRecorder = new MediaRecorder(stream as MediaStream, {
        mimeType,
      });
      const adapter: RecorderLike = {
        get state() {
          return nativeRecorder.state;
        },
        ondataavailable: null,
        onstop: null,
        onerror: null,
        start: () => nativeRecorder.start(),
        stop: () => nativeRecorder.stop(),
      };
      nativeRecorder.ondataavailable = (event) =>
        adapter.ondataavailable?.({ data: event.data });
      nativeRecorder.onstop = () => adapter.onstop?.();
      nativeRecorder.onerror = () => adapter.onerror?.();
      return adapter;
    },
    createLevelMonitor: (stream, onSample) => {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream as MediaStream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2_048;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let squared = 0;
        for (const sample of samples) squared += sample * sample;
        onSample(
          Math.min(1, Math.sqrt(squared / samples.length)),
          performance.now(),
        );
      }, 50);
      return {
        stop() {
          clearInterval(timer);
          source.disconnect();
          void context.close();
        },
      };
    },
  };
}

function captureFailure(error: unknown): VoiceRecorderFailureCode {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError')
    return 'permission_denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return 'no_input';
  return 'capture_failed';
}

/** 录制一段 WebM/Opus；VAD 或取消到达终态后立即释放全部设备资源。 */
export async function recordVoice(
  options: { signal?: AbortSignal; onLevel?: (level: number) => void } = {},
  dependencies: VoiceRecorderDependencies = browserDependencies(),
): Promise<VoiceRecordingResult> {
  if (options.signal?.aborted) return { ok: false, code: 'aborted' };
  const mimeType = selectVoiceRecordingMimeType((type) =>
    dependencies.isTypeSupported(type),
  );
  if (!mimeType) return { ok: false, code: 'unsupported' };

  let stream: StreamLike;
  try {
    stream = await dependencies.getUserMedia();
  } catch (error) {
    return { ok: false, code: captureFailure(error) };
  }
  if (options.signal?.aborted) {
    for (const track of stream.getTracks()) track.stop();
    return { ok: false, code: 'aborted' };
  }

  return new Promise((resolve) => {
    const recorder = dependencies.createRecorder(stream, mimeType);
    const vad = createVoiceVad();
    const chunks: Blob[] = [];
    let failure: VoiceRecorderFailureCode | null = null;
    let settled = false;
    let monitor: LevelMonitor | null = null;

    const cleanup = (): void => {
      monitor?.stop();
      monitor = null;
      for (const track of stream.getTracks()) track.stop();
      options.signal?.removeEventListener('abort', onAbort);
      options.onLevel?.(0);
    };
    const finish = (result: VoiceRecordingResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const stopWith = (code: VoiceRecorderFailureCode | null): void => {
      if (settled) return;
      failure = code;
      if (recorder.state === 'recording') recorder.stop();
      else if (code) finish({ ok: false, code });
    };
    const onAbort = (): void => stopWith('aborted');

    recorder.ondataavailable = ({ data }) => {
      if (!failure && data.size > 0) chunks.push(data);
    };
    recorder.onerror = () => stopWith('capture_failed');
    recorder.onstop = () => {
      if (failure) {
        finish({ ok: false, code: failure });
        return;
      }
      void new Blob(chunks, { type: mimeType })
        .arrayBuffer()
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          finish(
            bytes.byteLength > 0
              ? {
                  ok: true,
                  recording: { bytes, mimeType: 'audio/webm' },
                }
              : { ok: false, code: 'capture_failed' },
          );
        })
        .catch(() => finish({ ok: false, code: 'capture_failed' }));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      recorder.start();
      monitor = dependencies.createLevelMonitor(stream, (level, nowMs) => {
        options.onLevel?.(level);
        const decision = vad.observe(level, nowMs);
        if (decision === 'complete' || decision === 'max-duration') {
          stopWith(null);
        } else if (decision === 'no-speech') {
          stopWith('no_speech');
        }
      });
    } catch {
      finish({ ok: false, code: 'capture_failed' });
    }
  });
}
