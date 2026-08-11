import { describe, expect, it } from 'vitest';
import { parseDashScopeSpeechConfiguration } from './dashscope-speech-config';

describe('parseDashScopeSpeechConfiguration', () => {
  it('默认冻结北京区 Paraformer/CosyVoice/longanyang', () => {
    const result = parseDashScopeSpeechConfiguration({
      DASHSCOPE_API_KEY: 'k'.repeat(32),
      DASHSCOPE_WORKSPACE_ID: 'ws-test',
    });
    expect(result).toMatchObject({
      enabled: true,
      configuration: {
        websocketUrl:
          'wss://ws-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
        asrModel: 'paraformer-realtime-v2',
        ttsModel: 'cosyvoice-v3-flash',
        voice: 'longanyang',
      },
    });
  });

  it('空白可选变量仍使用安全默认值', () => {
    const result = parseDashScopeSpeechConfiguration({
      DASHSCOPE_API_KEY: 'k'.repeat(32),
      DASHSCOPE_WORKSPACE_ID: 'ws-test',
      DASHSCOPE_BEIJING_WS_URL: '',
      DASHSCOPE_ASR_MODEL: ' ',
      DASHSCOPE_TTS_MODEL: '',
      DASHSCOPE_TTS_VOICE: ' ',
    });
    expect(result).toMatchObject({
      enabled: true,
      configuration: {
        websocketUrl:
          'wss://ws-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
        asrModel: 'paraformer-realtime-v2',
        ttsModel: 'cosyvoice-v3-flash',
        voice: 'longanyang',
      },
    });
  });

  it('缺失或非北京 wss 配置 fail closed 且不回显 secret', () => {
    expect(parseDashScopeSpeechConfiguration({})).toEqual({
      enabled: false,
      reason: 'not_configured',
    });
    const result = parseDashScopeSpeechConfiguration({
      DASHSCOPE_API_KEY: 'secret-value-that-must-not-leak',
      DASHSCOPE_WORKSPACE_ID: 'ws-test',
      DASHSCOPE_BEIJING_WS_URL: 'wss://attacker.invalid/api-ws/v1/inference',
    });
    expect(result).toEqual({ enabled: false, reason: 'invalid_configuration' });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('拒绝与 Workspace 不匹配的北京专属域名', () => {
    expect(
      parseDashScopeSpeechConfiguration({
        DASHSCOPE_API_KEY: 'k'.repeat(32),
        DASHSCOPE_WORKSPACE_ID: 'ws-test',
        DASHSCOPE_BEIJING_WS_URL:
          'wss://other-workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
      }),
    ).toEqual({ enabled: false, reason: 'invalid_configuration' });
  });
});
