import { describe, expect, it } from 'vitest';
import {
  evaluateVoiceCapability,
  voiceCapabilityReasonLabel,
  type VoiceCapabilityCheck,
} from './voice-capability';

const ALL_HEALTHY: readonly VoiceCapabilityCheck[] = [
  { key: 'model', healthy: true },
  { key: 'connection', healthy: true },
  { key: 'consent', healthy: true },
  { key: 'retention', healthy: true },
  { key: 'deletion-worker', healthy: true },
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

  it('同意撤回（consent 不健康）→ CONSENT_NOT_GRANTED', () => {
    const state = evaluateVoiceCapability(
      ALL_HEALTHY.map((check) =>
        check.key === 'consent' ? { ...check, healthy: false } : check,
      ),
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('CONSENT_NOT_GRANTED');
  });

  it('连接、留存、删除 Worker 任一不健康各自有稳定原因', () => {
    const cases: Array<[VoiceCapabilityCheck['key'], string]> = [
      ['connection', 'CONNECTION_UNAVAILABLE'],
      ['retention', 'RETENTION_UNAVAILABLE'],
      ['deletion-worker', 'DELETION_WORKER_UNAVAILABLE'],
    ];
    for (const [key, reason] of cases) {
      const state = evaluateVoiceCapability(
        ALL_HEALTHY.map((check) =>
          check.key === key ? { ...check, healthy: false } : check,
        ),
      );
      expect(state.enabled).toBe(false);
      expect(state.reason).toBe(reason);
    }
  });

  it('多个不健康：unhealthy 按声明顺序列出，reason 取第一个', () => {
    const state = evaluateVoiceCapability([
      { key: 'deletion-worker', healthy: false },
      { key: 'model', healthy: false },
      { key: 'consent', healthy: false },
      { key: 'connection', healthy: true },
      { key: 'retention', healthy: true },
    ]);
    expect(state.reason).toBe('MODEL_UNAVAILABLE');
    expect(state.unhealthy).toEqual([
      'MODEL_UNAVAILABLE',
      'CONSENT_NOT_GRANTED',
      'DELETION_WORKER_UNAVAILABLE',
    ]);
  });

  it('缺失维度视为不健康（fail closed：五维必须全部显式声明）', () => {
    const state = evaluateVoiceCapability([
      { key: 'model', healthy: true },
      { key: 'connection', healthy: true },
      // 缺 consent / retention / deletion-worker
    ]);
    expect(state.enabled).toBe(false);
    expect(state.unhealthy).toEqual([
      'CONSENT_NOT_GRANTED',
      'RETENTION_UNAVAILABLE',
      'DELETION_WORKER_UNAVAILABLE',
    ]);
  });

  it('空 capability（全部缺失）→ 禁用', () => {
    const state = evaluateVoiceCapability([]);
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('MODEL_UNAVAILABLE');
    expect(state.unhealthy).toHaveLength(5);
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

describe('voiceCapabilityReasonLabel', () => {
  it('每个稳定原因都有稳定可读文案', () => {
    expect(voiceCapabilityReasonLabel('MODEL_UNAVAILABLE')).toBe(
      '语音模型暂不可用',
    );
    expect(voiceCapabilityReasonLabel('CONNECTION_UNAVAILABLE')).toBe(
      '实时语音连接暂不可用',
    );
    expect(voiceCapabilityReasonLabel('CONSENT_NOT_GRANTED')).toContain(
      '监护人同意',
    );
    expect(voiceCapabilityReasonLabel('RETENTION_UNAVAILABLE')).toContain(
      '留存',
    );
    expect(voiceCapabilityReasonLabel('DELETION_WORKER_UNAVAILABLE')).toContain(
      '删除',
    );
  });
});
