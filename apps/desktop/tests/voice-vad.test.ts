import { describe, expect, it } from 'vitest';
import {
  createVoiceVad,
  selectVoiceRecordingMimeType,
} from '../src/renderer/src/voice-vad';

describe('桌宠本地 VAD', () => {
  it('检测到有效说话后连续静音 900ms 自动结束', () => {
    const vad = createVoiceVad();

    expect(vad.observe(0.04, 0)).toBe('continue');
    expect(vad.observe(0.05, 100)).toBe('continue');
    expect(vad.observe(0.05, 250)).toBe('speech-started');
    expect(vad.observe(0.005, 400)).toBe('continue');
    expect(vad.observe(0.004, 1_299)).toBe('continue');
    expect(vad.observe(0.004, 1_300)).toBe('complete');
  });

  it('8 秒内没有有效说话返回 no-speech', () => {
    const vad = createVoiceVad();

    expect(vad.observe(0.002, 0)).toBe('continue');
    expect(vad.observe(0.02, 2_000)).toBe('continue');
    expect(vad.observe(0.002, 8_000)).toBe('no-speech');
  });

  it('零碎噪音未达到最小说话时长时不误判为说完', () => {
    const vad = createVoiceVad();

    expect(vad.observe(0.05, 0)).toBe('continue');
    expect(vad.observe(0.05, 100)).toBe('continue');
    expect(vad.observe(0.001, 300)).toBe('continue');
    expect(vad.observe(0.001, 1_500)).toBe('continue');
  });

  it('30 秒硬上限优先收敛为 max-duration', () => {
    const vad = createVoiceVad();

    expect(vad.observe(0.05, 0)).toBe('continue');
    expect(vad.observe(0.05, 250)).toBe('speech-started');
    expect(vad.observe(0.05, 30_000)).toBe('max-duration');
  });
});

describe('录音 MIME 选择', () => {
  it('优先 WebM/Opus，回退 WebM，不支持时返回 null', () => {
    expect(selectVoiceRecordingMimeType((type) => type.includes('opus'))).toBe(
      'audio/webm;codecs=opus',
    );
    expect(selectVoiceRecordingMimeType((type) => type === 'audio/webm')).toBe(
      'audio/webm',
    );
    expect(selectVoiceRecordingMimeType(() => false)).toBeNull();
  });
});
