import { describe, expect, it, vi } from 'vitest';
import { bindVoiceTurn } from '../src/renderer/src/voice-session';

describe('bindVoiceTurn', () => {
  it('在同一语音链路中传递稳定的 clientMessageId', async () => {
    const turn = vi.fn(async () => ({
      ok: true as const,
      action: 'none' as const,
      message: '完成',
    }));
    const bound = bindVoiceTurn(turn, 'desktop:voice:stable');

    await bound('整理今天的笔记', 'request:one');

    expect(turn).toHaveBeenCalledWith(
      '整理今天的笔记',
      'request:one',
      'voice',
      'desktop:voice:stable',
    );
  });
});
