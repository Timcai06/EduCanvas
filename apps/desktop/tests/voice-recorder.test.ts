import { describe, expect, it } from 'vitest';
import {
  recordVoice,
  type RecorderLike,
  type VoiceRecorderDependencies,
} from '../src/renderer/src/voice-recorder';

class FakeRecorder implements RecorderLike {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1])]),
    });
    queueMicrotask(() => this.onstop?.());
  }
}

function harness() {
  const recorder = new FakeRecorder();
  let sample: ((level: number, nowMs: number) => void) | null = null;
  let tracksStopped = 0;
  let monitorStopped = 0;
  const dependencies: VoiceRecorderDependencies = {
    getUserMedia: async () => ({
      getTracks: () => [{ stop: () => (tracksStopped += 1) }],
    }),
    isTypeSupported: () => true,
    createRecorder: () => recorder,
    createLevelMonitor: (_stream, onSample) => {
      sample = onSample;
      return { stop: () => (monitorStopped += 1) };
    },
  };
  return {
    dependencies,
    emit(level: number, nowMs: number) {
      if (!sample) throw new Error('monitor not started');
      sample(level, nowMs);
    },
    stopped: () => ({ tracksStopped, monitorStopped }),
  };
}

describe('recordVoice', () => {
  it('VAD 结束后返回内存中的 WebM 字节并释放设备', async () => {
    const h = harness();
    const pending = recordVoice({}, h.dependencies);
    await Promise.resolve();

    h.emit(0.05, 0);
    h.emit(0.05, 250);
    h.emit(0.001, 400);
    h.emit(0.001, 1_300);

    await expect(pending).resolves.toEqual({
      ok: true,
      recording: {
        bytes: Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1]),
        mimeType: 'audio/webm',
      },
    });
    expect(h.stopped()).toEqual({ tracksStopped: 1, monitorStopped: 1 });
  });

  it('用户取消丢弃录音并释放设备', async () => {
    const h = harness();
    const controller = new AbortController();
    const pending = recordVoice({ signal: controller.signal }, h.dependencies);
    await Promise.resolve();

    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false, code: 'aborted' });
    expect(h.stopped()).toEqual({ tracksStopped: 1, monitorStopped: 1 });
  });

  it('无有效说话时不上传空录音', async () => {
    const h = harness();
    const pending = recordVoice({}, h.dependencies);
    await Promise.resolve();

    h.emit(0.001, 0);
    h.emit(0.001, 8_000);

    await expect(pending).resolves.toEqual({ ok: false, code: 'no_speech' });
  });

  it('麦克风拒绝映射为 permission_denied，不外泄原始异常', async () => {
    const error = Object.assign(new Error('private device path'), {
      name: 'NotAllowedError',
    });
    const h = harness();
    h.dependencies.getUserMedia = async () => {
      throw error;
    };

    await expect(recordVoice({}, h.dependencies)).resolves.toEqual({
      ok: false,
      code: 'permission_denied',
    });
  });
});
