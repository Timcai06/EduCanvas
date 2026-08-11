import { describe, expect, it } from 'vitest';
import {
  evaluateTranscriptionCapability,
  evaluateVoiceCapability,
  voiceCapabilityReasonLabel,
  type VoiceCapabilityCheck,
} from './voice-capability';

const ALL_HEALTHY: readonly VoiceCapabilityCheck[] = [
  { key: 'model', healthy: true },
  { key: 'speech', healthy: true },
  { key: 'connection', healthy: true },
];

describe('evaluateVoiceCapability', () => {
  it('全部健康：入口启用，无原因', () => {
    const state = evaluateVoiceCapability(ALL_HEALTHY);
    expect(state).toEqual({
      enabled: true,
      reason: null,
      unhealthy: [],
    });
  });

  it('任一维度不健康即禁用（模型）', () => {
    const state = evaluateVoiceCapability([
      ...ALL_HEALTHY.slice(0, 0),
      { key: 'model', healthy: false },
      ...ALL_HEALTHY.slice(1),
    ]);
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('MODEL_UNAVAILABLE');
  });

  it('连接不健康时返回稳定原因', () => {
    const state = evaluateVoiceCapability([
      { key: 'model', healthy: true },
      { key: 'speech', healthy: true },
      { key: 'connection', healthy: false },
    ]);
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('CONNECTION_UNAVAILABLE');
  });

  it('多个不健康：unhealthy 按声明顺序列出，reason 取第一个', () => {
    const state = evaluateVoiceCapability([
      { key: 'model', healthy: false },
      { key: 'speech', healthy: false },
      { key: 'connection', healthy: false },
    ]);
    expect(state.reason).toBe('MODEL_UNAVAILABLE');
    expect(state.unhealthy).toEqual([
      'MODEL_UNAVAILABLE',
      'SPEECH_UNAVAILABLE',
      'CONNECTION_UNAVAILABLE',
    ]);
  });

  it('缺失维度视为不健康（fail closed：三项必须全部显式声明）', () => {
    const state = evaluateVoiceCapability([{ key: 'model', healthy: true }]);
    expect(state.enabled).toBe(false);
    expect(state.unhealthy).toEqual([
      'SPEECH_UNAVAILABLE',
      'CONNECTION_UNAVAILABLE',
    ]);
  });

  it('空 capability（全部缺失）→ 禁用', () => {
    const state = evaluateVoiceCapability([]);
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('MODEL_UNAVAILABLE');
    expect(state.unhealthy).toHaveLength(3);
  });

  it('重复 capability key（非法输入）→ 禁用为 CAPABILITY_CONFIG_INVALID', () => {
    const state = evaluateVoiceCapability([
      ...ALL_HEALTHY,
      { key: 'model', healthy: true },
    ]);
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('CAPABILITY_CONFIG_INVALID');
    expect(state.unhealthy).toEqual(['CAPABILITY_CONFIG_INVALID']);
  });

  it('未知 capability key（非法输入）→ 禁用为 CAPABILITY_CONFIG_INVALID', () => {
    const state = evaluateVoiceCapability([
      ...ALL_HEALTHY,
      { key: 'unknown-dimension' as never, healthy: true },
    ]);
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('CAPABILITY_CONFIG_INVALID');
  });

  it('纯函数：输入不被修改', () => {
    const input = [...ALL_HEALTHY];
    const snapshot = JSON.stringify(input);
    evaluateVoiceCapability(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('evaluateTranscriptionCapability', () => {
  it('TTS 不可用时仍允许实时语音输入', () => {
    expect(
      evaluateTranscriptionCapability(
        ALL_HEALTHY.map((check) =>
          check.key === 'speech' ? { ...check, healthy: false } : check,
        ),
      ),
    ).toEqual({ enabled: true, reason: null, unhealthy: [] });
  });

  it('ASR 或连接不可用时保持关闭', () => {
    const result = evaluateTranscriptionCapability(
      ALL_HEALTHY.map((check) =>
        check.key === 'model' ? { ...check, healthy: false } : check,
      ),
    );
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('MODEL_UNAVAILABLE');
  });
});

describe('voiceCapabilityReasonLabel', () => {
  it('每个稳定原因都有稳定可读文案', () => {
    expect(voiceCapabilityReasonLabel('MODEL_UNAVAILABLE')).toBe(
      '语音模型暂不可用',
    );
    expect(voiceCapabilityReasonLabel('CONNECTION_UNAVAILABLE')).toBe(
      '实时语音连接暂不可用',
    );
    expect(voiceCapabilityReasonLabel('SPEECH_UNAVAILABLE')).toContain('播报');
    expect(voiceCapabilityReasonLabel('CAPABILITY_CONFIG_INVALID')).toContain(
      '配置',
    );
  });
});
