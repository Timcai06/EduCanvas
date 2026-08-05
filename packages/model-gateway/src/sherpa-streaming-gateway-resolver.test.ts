/**
 * V09-F 组合闸门测试：fail-closed 各分支、稳定 reason、SDK 懒加载。
 *
 * 用内存 fake 依赖（文件系统/SDK），不读取真实模型；断言校验失败时
 * SDK 加载次数为 0（即 recognizerFactory.create 不会被调用）。
 */
import { describe, expect, it } from 'vitest';
import { sherpaModelProfiles } from './sherpa-model-manifest';
import {
  resolveSherpaStreamingTranscriptionGateway,
  validateSherpaHotwordsText,
  type SherpaStreamingGatewayDependencies,
  type SherpaStreamingUnavailableReason,
} from './sherpa-streaming-gateway-resolver';
import { sherpaStreamingEnvNames } from './sherpa-streaming-config';

const PROFILE = sherpaModelProfiles['480ms']!;

interface FakeState {
  dirs: Set<string>;
  files: Map<string, string>;
  hotwords: Map<string, string>;
  sdkLoads: number;
}

function makeState(): FakeState {
  return {
    dirs: new Set(),
    files: new Map(),
    hotwords: new Map(),
    sdkLoads: 0,
  };
}

/** 把某 profile 的完整模型目录（全部必需文件 + 正确 hash）写入 fake 状态。 */
function installFakeModel(
  state: FakeState,
  modelDir: string,
  profile: typeof PROFILE | null = PROFILE,
): void {
  state.dirs.add(modelDir);
  if (profile === null) return;
  for (const [name, hash] of Object.entries(profile.files)) {
    state.files.set(`${modelDir}/${name}`, hash);
  }
}

function makeDeps(
  state: FakeState,
  overrides: Partial<SherpaStreamingGatewayDependencies> = {},
): SherpaStreamingGatewayDependencies {
  return {
    isDirectory: (path) => state.dirs.has(path),
    isFile: (path) => state.files.has(path) || state.hotwords.has(path),
    sha256File: async (path) => {
      const hash = state.files.get(path);
      if (hash === undefined) throw new Error('missing_file');
      return hash;
    },
    readHotwords: (path) => {
      const text = state.hotwords.get(path);
      if (text === undefined) throw new Error('missing_hotwords');
      return text;
    },
    loadSdk: () => {
      state.sdkLoads += 1;
      return { createOnlineRecognizer: () => ({}) as never };
    },
    ...overrides,
  };
}

const env = (overrides: Record<string, string> = {}) => ({
  ...overrides,
});

const enabledEnv = (modelDir: string, profile = '480ms') =>
  env({
    [sherpaStreamingEnvNames.enabled]: 'true',
    [sherpaStreamingEnvNames.profile]: profile,
    [sherpaStreamingEnvNames.modelDir]: modelDir,
  });

describe('resolveSherpaStreamingTranscriptionGateway（V09-F）', () => {
  it('验收 1：默认关闭 → unavailable 且 SDK 零加载', async () => {
    const state = makeState();
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      env({}),
      makeDeps(state),
    );
    expect(resolution).toEqual({
      gateway: null,
      reason: 'streaming_disabled',
    });
    expect(state.sdkLoads).toBe(0);
  });

  it('验收 2：配置不完整（启用但缺 profile）→ unavailable', async () => {
    const state = makeState();
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      env({ [sherpaStreamingEnvNames.enabled]: 'true' }),
      makeDeps(state),
    );
    expect(resolution.reason).toBe('streaming_disabled');
    expect(state.sdkLoads).toBe(0);
  });

  it('验收 3：未知 profile → unavailable', async () => {
    const state = makeState();
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/models/x', '960ms'),
      makeDeps(state),
    );
    expect(resolution.reason).toBe('unknown_profile');
    expect(state.sdkLoads).toBe(0);
  });

  it('验收 4：480ms 完整配置 → gateway 可用', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/models/480ms', '480ms'),
      makeDeps(state),
    );
    expect(resolution.reason).toBeNull();
    expect(resolution.gateway).not.toBeNull();
    expect(state.sdkLoads).toBe(1);
  });

  it('验收 5：1920ms 完整配置 → gateway 可用', async () => {
    const state = makeState();
    const profile1920 = sherpaModelProfiles['1920ms']!;
    installFakeModel(state, '/models/1920ms', profile1920);
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/models/1920ms', '1920ms'),
      makeDeps(state),
    );
    expect(resolution.reason).toBeNull();
    expect(resolution.gateway).not.toBeNull();
  });

  it('验收 6：模型目录不存在 → model_directory_missing', async () => {
    const state = makeState();
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/models/absent'),
      makeDeps(state),
    );
    expect(resolution.reason).toBe('model_directory_missing');
    expect(state.sdkLoads).toBe(0);
  });

  it('验收 8：任一必需模型文件缺失 → model_file_missing', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    state.files.delete('/models/480ms/tokens.txt');
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/models/480ms'),
      makeDeps(state),
    );
    expect(resolution.reason).toBe('model_file_missing');
    expect(state.sdkLoads).toBe(0);
  });

  it('验收 9：任一模型文件 checksum 不匹配 → model_file_checksum_mismatch', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    state.files.set('/models/480ms/encoder.int8.onnx', 'deadbeef'.repeat(8));
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/models/480ms'),
      makeDeps(state),
    );
    expect(resolution.reason).toBe('model_file_checksum_mismatch');
    expect(state.sdkLoads).toBe(0);
  });

  it('sha256 读取失败（权限/并发删除）→ checksum_mismatch，异常不逃逸', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    const deps = makeDeps(state, {
      sha256File: async () => {
        throw new Error('EACCES: permission denied');
      },
    });
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/models/480ms'),
      deps,
    );
    expect(resolution.reason).toBe('model_file_checksum_mismatch');
    expect(state.sdkLoads).toBe(0);
  });

  it('bpe.vocab 读取失败 → model_file_checksum_mismatch，异常不逃逸', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    state.hotwords.set('/data/hotwords.txt', '贝叶斯定理\n');
    const deps = makeDeps(state, {
      sha256File: async (path) => {
        if (path.endsWith('/bpe.vocab')) {
          throw new Error('EACCES');
        }
        return state.files.get(path) ?? 'missing';
      },
    });
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      env({
        ...enabledEnv('/models/480ms'),
        [sherpaStreamingEnvNames.hotwordsPath]: '/data/hotwords.txt',
      }),
      deps,
    );
    expect(resolution.reason).toBe('model_file_checksum_mismatch');
    expect(state.sdkLoads).toBe(0);
  });

  it('验收 10：热词未配置 → 正常创建（bpe.vocab 仍是必需文件）', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/models/480ms'),
      makeDeps(state),
    );
    expect(resolution.reason).toBeNull();
    expect(resolution.gateway).not.toBeNull();
  });

  it('bpe.vocab 缺失 → model_file_missing（真实 SDK 强制要求，与热词无关）', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    state.files.delete('/models/480ms/bpe.vocab');
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/models/480ms'),
      makeDeps(state),
    );
    expect(resolution.reason).toBe('model_file_missing');
    expect(state.sdkLoads).toBe(0);
  });

  it('验收 11：声明热词但热词文件缺失 → hotwords_file_missing', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      env({
        ...enabledEnv('/models/480ms'),
        [sherpaStreamingEnvNames.hotwordsPath]: '/data/hotwords.txt',
      }),
      makeDeps(state),
    );
    expect(resolution.reason).toBe('hotwords_file_missing');
    expect(state.sdkLoads).toBe(0);
  });

  it('bpe.vocab 缺失（热词启用）→ model_file_missing', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    state.files.delete('/models/480ms/bpe.vocab');
    state.hotwords.set('/data/hotwords.txt', '贝叶斯定理\n过拟合\n');
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      env({
        ...enabledEnv('/models/480ms'),
        [sherpaStreamingEnvNames.hotwordsPath]: '/data/hotwords.txt',
      }),
      makeDeps(state),
    );
    expect(resolution.reason).toBe('model_file_missing');
    expect(state.sdkLoads).toBe(0);
  });

  it('bpe.vocab checksum 不匹配（热词启用）→ model_file_checksum_mismatch', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    state.files.set('/models/480ms/bpe.vocab', 'cafebabe'.repeat(8));
    state.hotwords.set('/data/hotwords.txt', '贝叶斯定理\n');
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      env({
        ...enabledEnv('/models/480ms'),
        [sherpaStreamingEnvNames.hotwordsPath]: '/data/hotwords.txt',
      }),
      makeDeps(state),
    );
    expect(resolution.reason).toBe('model_file_checksum_mismatch');
    expect(state.sdkLoads).toBe(0);
  });

  it('验收 12：非法热词内容（空行/控制字符）→ hotwords_file_invalid', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    state.hotwords.set('/data/hotwords.txt', '贝叶斯定理\n\n过拟合\n');
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      env({
        ...enabledEnv('/models/480ms'),
        [sherpaStreamingEnvNames.hotwordsPath]: '/data/hotwords.txt',
      }),
      makeDeps(state),
    );
    expect(resolution.reason).toBe('hotwords_file_invalid');
    expect(state.sdkLoads).toBe(0);
  });

  it('验收 12b：合法热词（含 :score 后缀）→ 创建成功', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    state.hotwords.set(
      '/data/hotwords.txt',
      '贝叶斯定理:3.5\nBagging:2.0\nBoosting\n',
    );
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      env({
        ...enabledEnv('/models/480ms'),
        [sherpaStreamingEnvNames.hotwordsPath]: '/data/hotwords.txt',
      }),
      makeDeps(state),
    );
    expect(resolution.reason).toBeNull();
    expect(resolution.gateway).not.toBeNull();
  });

  it('验收 17：SDK 加载失败 → sdk_load_failed（fail-closed）', async () => {
    const state = makeState();
    installFakeModel(state, '/models/480ms');
    const deps = makeDeps(state, {
      loadSdk: () => {
        state.sdkLoads += 1;
        throw new Error('wasm init failure');
      },
    });
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/models/480ms'),
      deps,
    );
    expect(resolution.reason).toBe('sdk_load_failed');
    expect(resolution.gateway).toBeNull();
  });

  it('验收 18：reason 是稳定码，不含模型路径', async () => {
    const state = makeState();
    const resolution = await resolveSherpaStreamingTranscriptionGateway(
      enabledEnv('/very/secret/model/path'),
      makeDeps(state),
    );
    expect(resolution.reason).toMatch(/^[a-z_]+$/);
    expect(JSON.stringify(resolution)).not.toContain('/very/secret');
  });
});

describe('validateSherpaHotwordsText', () => {
  it('空文件非法', () => {
    expect(validateSherpaHotwordsText('')).toBe(false);
  });
  it('正常热词合法', () => {
    expect(validateSherpaHotwordsText('贝叶斯定理\nBagging\n')).toBe(true);
  });
  it('score 后缀合法', () => {
    expect(validateSherpaHotwordsText('贝叶斯定理:3.5\n')).toBe(true);
  });
  it('score 非正非法', () => {
    expect(validateSherpaHotwordsText('贝叶斯定理:0\n')).toBe(false);
    expect(validateSherpaHotwordsText('贝叶斯定理:-1\n')).toBe(false);
  });
  it('控制字符非法', () => {
    expect(validateSherpaHotwordsText('贝\x00叶\n')).toBe(false);
  });
  it('超长行非法', () => {
    expect(validateSherpaHotwordsText(`${'x'.repeat(201)}\n`)).toBe(false);
  });
  it('空行非法', () => {
    expect(validateSherpaHotwordsText('贝叶斯定理\n\n')).toBe(false);
  });
});
