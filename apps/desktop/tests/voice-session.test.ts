import { describe, expect, it, vi } from 'vitest';
import { runVoiceSession } from '../src/renderer/src/voice-session';
import type { VoiceSessionDependencies } from '../src/renderer/src/voice-session';

function successfulDependencies(
  overrides: Partial<VoiceSessionDependencies> = {},
): VoiceSessionDependencies {
  return {
    record: vi.fn(async () => ({
      ok: true as const,
      recording: {
        bytes: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
        mimeType: 'audio/webm' as const,
      },
    })),
    transcribe: vi.fn(async () => ({
      ok: true as const,
      text: '整理今天的数学笔记',
    })),
    turn: vi.fn(async () => ({
      ok: true as const,
      action: 'none',
      message: '好的，我来帮你整理。',
      assistantMessageId: 'message:assistant:one',
    })),
    synthesize: vi.fn(async () => ({
      ok: true as const,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'audio/mpeg' as const,
    })),
    play: vi.fn(async () => 'finished' as const),
    cancelRemote: vi.fn(),
    createRequestId: vi.fn(() => crypto.randomUUID()),
    ...overrides,
  };
}

describe('runVoiceSession', () => {
  it('按录音、转写、思考、播报的顺序完成，并持续提供字幕', async () => {
    const phases: string[] = [];
    const transcripts: string[] = [];
    const replies: string[] = [];
    const deps = successfulDependencies();

    const result = await runVoiceSession(deps, {
      signal: new AbortController().signal,
      onChange(snapshot) {
        phases.push(snapshot.phase);
        if (snapshot.transcript) transcripts.push(snapshot.transcript);
        if (snapshot.reply) replies.push(snapshot.reply);
      },
    });

    expect(result).toEqual({
      outcome: 'success',
      transcript: '整理今天的数学笔记',
      reply: '好的，我来帮你整理。',
      assistantMessageId: 'message:assistant:one',
      speechPlayed: true,
    });
    expect(phases).toEqual([
      'starting',
      'listening',
      'transcribing',
      'thinking',
      'speaking',
      'success',
    ]);
    expect(transcripts).toContain('整理今天的数学笔记');
    expect(replies).toContain('好的，我来帮你整理。');
    expect(deps.synthesize).toHaveBeenCalledWith(
      '好的，我来帮你整理。',
      expect.any(String),
      'message:assistant:one',
    );
  });

  it('TTS 失败时保留回复字幕并以降级成功结束', async () => {
    const deps = successfulDependencies({
      synthesize: vi.fn(async () => ({
        ok: false as const,
        code: 'backend_offline' as const,
        message: 'speech unavailable',
      })),
    });
    const snapshots: Array<{ phase: string; reply?: string; notice?: string }> =
      [];

    const result = await runVoiceSession(deps, {
      signal: new AbortController().signal,
      onChange: (snapshot) => snapshots.push(snapshot),
    });

    expect(result).toMatchObject({
      outcome: 'success',
      reply: '好的，我来帮你整理。',
      speechPlayed: false,
    });
    expect(snapshots.at(-1)).toMatchObject({
      phase: 'success',
      reply: '好的，我来帮你整理。',
      notice: '语音播报暂不可用，已显示文字回复',
    });
  });

  it('取消活动中的远端请求并进入 cancelled，不继续后续步骤', async () => {
    const controller = new AbortController();
    let release!: (value: {
      ok: false;
      code: 'aborted';
      message: string;
    }) => void;
    const deps = successfulDependencies({
      createRequestId: vi.fn(() => 'asr-1'),
      transcribe: vi.fn(
        (_input, _requestId) =>
          new Promise<
            Awaited<ReturnType<VoiceSessionDependencies['transcribe']>>
          >((resolve) => {
            release = resolve;
          }),
      ),
    });
    const phases: string[] = [];
    const pending = runVoiceSession(deps, {
      signal: controller.signal,
      onChange: (snapshot) => phases.push(snapshot.phase),
    });
    await vi.waitFor(() => expect(deps.transcribe).toHaveBeenCalled());

    controller.abort();
    release({ ok: false, code: 'aborted', message: 'cancelled' });
    const result = await pending;

    expect(deps.cancelRemote).toHaveBeenCalledWith('asr-1');
    expect(deps.turn).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(phases.at(-1)).toBe('cancelled');
  });

  it('无语音输入时给出可重试的稳定错误', async () => {
    const deps = successfulDependencies({
      record: vi.fn(async () => ({
        ok: false as const,
        code: 'no_speech' as const,
      })),
    });
    const snapshots: Array<{ phase: string; error?: string }> = [];

    const result = await runVoiceSession(deps, {
      signal: new AbortController().signal,
      onChange: (snapshot) => snapshots.push(snapshot),
    });

    expect(result).toEqual({
      outcome: 'error',
      code: 'no_speech',
      message: '没有听到声音，请靠近一些再试一次',
    });
    expect(snapshots.at(-1)).toMatchObject({
      phase: 'error',
      error: '没有听到声音，请靠近一些再试一次',
    });
  });

  it('步骤边界发生取消时不启动下一项远端操作', async () => {
    const controller = new AbortController();
    const deps = successfulDependencies();

    const result = await runVoiceSession(deps, {
      signal: controller.signal,
      onChange(snapshot) {
        if (snapshot.phase === 'thinking') controller.abort();
      },
    });

    expect(result).toEqual({ outcome: 'cancelled' });
    expect(deps.turn).not.toHaveBeenCalled();
    expect(deps.synthesize).not.toHaveBeenCalled();
  });
});
