import { describe, expect, it } from 'vitest';
import { LiveSpeechResponseGate } from './live-speech-response-gate';

describe('LiveSpeechResponseGate', () => {
  it('不会把入室后的迟到旧消息当成本轮语音回答', () => {
    const gate = new LiveSpeechResponseGate();
    gate.reset(null);

    expect(gate.accepts('hydrated-old-assistant')).toBe(false);
  });

  it('用户终稿后只接纳下一条新 Assistant，并持续接纳它的 delta', () => {
    const gate = new LiveSpeechResponseGate();
    gate.reset('before-live');
    gate.expectNext('before-live');

    expect(gate.accepts('before-live')).toBe(false);
    expect(gate.accepts('live-answer')).toBe(true);
    expect(gate.accepts('live-answer')).toBe(true);
    expect(gate.accepts('unrelated-answer')).toBe(false);
  });

  it('每个 Live 用户终稿都重新开放恰好一个回答 ID', () => {
    const gate = new LiveSpeechResponseGate();
    gate.reset('before-live');
    gate.expectNext('before-live');
    expect(gate.accepts('answer-1')).toBe(true);

    gate.expectNext('answer-1');
    expect(gate.accepts('answer-1')).toBe(false);
    expect(gate.accepts('answer-2')).toBe(true);
  });
});
