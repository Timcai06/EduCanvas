export interface SpeechPlayerDependencies {
  decode(bytes: Uint8Array): Promise<unknown>;
  play(buffer: unknown, onEnded: () => void): { stop(): void };
  close(): Promise<void>;
}

export type SpeechPlaybackResult = 'finished' | 'aborted' | 'failed';

function browserDependencies(): SpeechPlayerDependencies {
  const context = new AudioContext();
  return {
    decode: (bytes) => context.decodeAudioData(bytes.slice().buffer),
    play: (buffer, onEnded) => {
      const source = context.createBufferSource();
      source.buffer = buffer as AudioBuffer;
      source.connect(context.destination);
      source.onended = onEnded;
      source.start();
      return { stop: () => source.stop() };
    },
    close: () => context.close(),
  };
}

/** 解码并播放一段 MP3；取消和失败都保证关闭 AudioContext。 */
export async function playSpeech(
  bytes: Uint8Array,
  options: { signal?: AbortSignal } = {},
  dependencies: SpeechPlayerDependencies = browserDependencies(),
): Promise<'finished' | 'aborted' | 'failed'> {
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await dependencies.close().catch(() => undefined);
  };
  if (options.signal?.aborted) {
    await close();
    return 'aborted';
  }

  try {
    const buffer = await dependencies.decode(bytes);
    if (options.signal?.aborted) {
      await close();
      return 'aborted';
    }
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result: 'finished' | 'aborted'): void => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        void close().then(() => resolve(result));
      };
      const source = dependencies.play(buffer, () => finish('finished'));
      const onAbort = (): void => {
        try {
          source.stop();
        } catch {
          // 已自然结束时 stop 可能抛错；终态仍按 aborted 收敛。
        }
        finish('aborted');
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
    });
  } catch {
    await close();
    return 'failed';
  }
}
