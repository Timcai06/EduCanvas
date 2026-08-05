/**
 * V09-D 实时流式配置解析测试：默认关闭、缺配置、未知 profile、无隐式默认
 * 目录、热词路径与 session timeout 边界。
 */
import { describe, expect, it } from 'vitest';
import {
  parseSherpaStreamingConfiguration,
  sherpaStreamingEnvNames,
  sherpaStreamingProfiles,
  SherpaStreamingConfigurationError,
  type EnabledSherpaStreamingConfiguration,
} from './sherpa-streaming-config';

const env = (overrides: Record<string, string | undefined> = {}) => ({
  ...overrides,
});

describe('parseSherpaStreamingConfiguration（V09-D）', () => {
  it('验收 1：默认关闭（ENABLED 未设置）', () => {
    const config = parseSherpaStreamingConfiguration(env({}));
    expect(config).toEqual({ enabled: false });
  });

  it('显式 false 关闭', () => {
    const config = parseSherpaStreamingConfiguration(
      env({ [sherpaStreamingEnvNames.enabled]: 'false' }),
    );
    expect(config).toEqual({ enabled: false });
  });

  it('ENABLED 非 true/false 拒绝', () => {
    expect(() =>
      parseSherpaStreamingConfiguration(
        env({ [sherpaStreamingEnvNames.enabled]: 'yes' }),
      ),
    ).toThrow(
      new SherpaStreamingConfigurationError('INVALID_STREAMING_ENABLED'),
    );
  });

  it('验收 2：启用但缺 profile', () => {
    expect(() =>
      parseSherpaStreamingConfiguration(
        env({
          [sherpaStreamingEnvNames.enabled]: 'true',
          [sherpaStreamingEnvNames.modelDir]: '/models/sherpa',
        }),
      ),
    ).toThrow(
      new SherpaStreamingConfigurationError('MISSING_STREAMING_PROFILE'),
    );
  });

  it('验收 3：未知 profile 形状合法时解析成功，白名单由 resolver 拒绝', () => {
    // 配置层只做形状校验；未知 profile 由 resolver 查 manifest 返回
    // unknown_profile（V09-B 白名单职责），见 resolver 测试。
    const config = parseSherpaStreamingConfiguration(
      env({
        [sherpaStreamingEnvNames.enabled]: 'true',
        [sherpaStreamingEnvNames.profile]: '960ms',
        [sherpaStreamingEnvNames.modelDir]: '/models/sherpa',
      }),
    ) as EnabledSherpaStreamingConfiguration;
    expect(config.profile).toBe('960ms');
  });

  it('profile 形状非法（控制字符/超长）拒绝', () => {
    expect(() =>
      parseSherpaStreamingConfiguration(
        env({
          [sherpaStreamingEnvNames.enabled]: 'true',
          [sherpaStreamingEnvNames.profile]: '48\n0ms',
          [sherpaStreamingEnvNames.modelDir]: '/models/sherpa',
        }),
      ),
    ).toThrow(
      new SherpaStreamingConfigurationError('INVALID_STREAMING_PROFILE'),
    );
  });

  it('启用但缺模型目录（无隐式默认）', () => {
    expect(() =>
      parseSherpaStreamingConfiguration(
        env({
          [sherpaStreamingEnvNames.enabled]: 'true',
          [sherpaStreamingEnvNames.profile]: '480ms',
        }),
      ),
    ).toThrow(
      new SherpaStreamingConfigurationError('MISSING_STREAMING_MODEL_DIR'),
    );
  });

  it('模型目录含控制字符拒绝', () => {
    expect(() =>
      parseSherpaStreamingConfiguration(
        env({
          [sherpaStreamingEnvNames.enabled]: 'true',
          [sherpaStreamingEnvNames.profile]: '480ms',
          [sherpaStreamingEnvNames.modelDir]: '/models/x\n1',
        }),
      ),
    ).toThrow(
      new SherpaStreamingConfigurationError('INVALID_STREAMING_MODEL_DIR'),
    );
  });

  it('模型目录必须是绝对路径', () => {
    expect(() =>
      parseSherpaStreamingConfiguration(
        env({
          [sherpaStreamingEnvNames.enabled]: 'true',
          [sherpaStreamingEnvNames.profile]: '480ms',
          [sherpaStreamingEnvNames.modelDir]: 'models/480ms',
        }),
      ),
    ).toThrow(
      new SherpaStreamingConfigurationError('INVALID_STREAMING_MODEL_DIR'),
    );
  });

  it('验收 4/5：480ms 与 1920ms 完整配置解析成功', () => {
    for (const profile of sherpaStreamingProfiles) {
      const config = parseSherpaStreamingConfiguration(
        env({
          [sherpaStreamingEnvNames.enabled]: 'true',
          [sherpaStreamingEnvNames.profile]: profile,
          [sherpaStreamingEnvNames.modelDir]: `/models/${profile}`,
          [sherpaStreamingEnvNames.sessionTimeoutMs]: '45000',
        }),
      ) as EnabledSherpaStreamingConfiguration;
      expect(config.enabled).toBe(true);
      expect(config.profile).toBe(profile);
      expect(config.modelDirectory).toBe(`/models/${profile}`);
      expect(config.hotwordsPath).toBeNull();
      expect(config.sessionTimeoutMs).toBe(45_000);
    }
  });

  it('验收 10：热词未配置时 hotwordsPath 为 null', () => {
    const config = parseSherpaStreamingConfiguration(
      env({
        [sherpaStreamingEnvNames.enabled]: 'true',
        [sherpaStreamingEnvNames.profile]: '480ms',
        [sherpaStreamingEnvNames.modelDir]: '/models/480ms',
      }),
    ) as EnabledSherpaStreamingConfiguration;
    expect(config.hotwordsPath).toBeNull();
  });

  it('声明热词路径时原样保留', () => {
    const config = parseSherpaStreamingConfiguration(
      env({
        [sherpaStreamingEnvNames.enabled]: 'true',
        [sherpaStreamingEnvNames.profile]: '480ms',
        [sherpaStreamingEnvNames.modelDir]: '/models/480ms',
        [sherpaStreamingEnvNames.hotwordsPath]: '/data/hotwords.txt',
      }),
    ) as EnabledSherpaStreamingConfiguration;
    expect(config.hotwordsPath).toBe('/data/hotwords.txt');
  });

  it('热词文件必须是绝对路径', () => {
    expect(() =>
      parseSherpaStreamingConfiguration(
        env({
          [sherpaStreamingEnvNames.enabled]: 'true',
          [sherpaStreamingEnvNames.profile]: '480ms',
          [sherpaStreamingEnvNames.modelDir]: '/models/480ms',
          [sherpaStreamingEnvNames.hotwordsPath]: 'hotwords.txt',
        }),
      ),
    ).toThrow(
      new SherpaStreamingConfigurationError('INVALID_STREAMING_HOTWORDS_PATH'),
    );
  });

  it('session timeout 越界拒绝', () => {
    expect(() =>
      parseSherpaStreamingConfiguration(
        env({
          [sherpaStreamingEnvNames.enabled]: 'true',
          [sherpaStreamingEnvNames.profile]: '480ms',
          [sherpaStreamingEnvNames.modelDir]: '/models/480ms',
          [sherpaStreamingEnvNames.sessionTimeoutMs]: '0',
        }),
      ),
    ).toThrow(
      new SherpaStreamingConfigurationError(
        'INVALID_STREAMING_SESSION_TIMEOUT',
      ),
    );
    expect(() =>
      parseSherpaStreamingConfiguration(
        env({
          [sherpaStreamingEnvNames.enabled]: 'true',
          [sherpaStreamingEnvNames.profile]: '480ms',
          [sherpaStreamingEnvNames.modelDir]: '/models/480ms',
          [sherpaStreamingEnvNames.sessionTimeoutMs]: '999999999',
        }),
      ),
    ).toThrow(
      new SherpaStreamingConfigurationError(
        'INVALID_STREAMING_SESSION_TIMEOUT',
      ),
    );
  });

  it('session timeout 缺省为 60 秒', () => {
    const config = parseSherpaStreamingConfiguration(
      env({
        [sherpaStreamingEnvNames.enabled]: 'true',
        [sherpaStreamingEnvNames.profile]: '480ms',
        [sherpaStreamingEnvNames.modelDir]: '/models/480ms',
      }),
    ) as EnabledSherpaStreamingConfiguration;
    expect(config.sessionTimeoutMs).toBe(60_000);
  });
});
