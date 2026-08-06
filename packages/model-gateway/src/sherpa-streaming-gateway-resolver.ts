/**
 * 实时流式转录（sherpa WASM）的唯一组合闸门（V09-F）。
 *
 * 这是实时语音链路的唯一构造入口：任何调用方（当前尚无生产组合，V12 起由
 * gateway 组合根消费）都必须从这里拿 Gateway。闸门是 fail-closed——
 * 以下任一条件不满足就返回 null + 稳定 reason，绝不创建半初始化 Adapter，
 * 也绝不调用 recognizerFactory.create()：
 *
 * - 未启用或配置不完整 → streaming_disabled
 * - profile 不在 manifest 白名单 → unknown_profile
 * - 模型目录不存在/不是目录 → model_directory_missing
 * - 任一必需模型文件缺失 → model_file_missing
 * - 任一必需模型文件 SHA-256 不匹配 → model_file_checksum_mismatch
 * - 声明热词但热词文件缺失 → hotwords_file_missing
 * - 热词文件内容非法 → hotwords_file_invalid
 * - bpe.vocab 缺失/校验失败归入通用文件校验（model_file_missing /
 *   model_file_checksum_mismatch）——它始终是必需文件，与热词无关
 * - sherpa-onnx SDK 加载失败 → sdk_load_failed
 *
 * 安全：reason 是稳定码，不携带模型路径、绝对路径或 SDK 原始异常；浏览器
 * 请求无法覆盖 profile/模型目录/热词路径——本函数只接受服务端环境 Record。
 *
 * 文件系统与 SDK 通过依赖注入，测试用内存 fake 验证 fail-closed 分支，
 * 不读取真实模型。
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelGatewayEnvironment } from './config-primitives';
import {
  getSherpaModelProfile,
  type SherpaModelProfile,
} from './sherpa-model-manifest';
import {
  parseSherpaStreamingConfiguration,
  type EnabledSherpaStreamingConfiguration,
} from './sherpa-streaming-config';
import {
  SherpaWasmRecognizerFactory,
  loadSherpaOnnxSdk,
} from './sherpa-streaming-recognizer-factory';
import { SherpaStreamingTranscriptionGateway } from './sherpa-streaming-transcription-gateway';
import type { SherpaWasmSdk } from './sherpa-wasm-types';

/** 闸门不可用时的稳定 reason；只用于审计/日志，不携带路径。 */
export type SherpaStreamingUnavailableReason =
  | 'streaming_disabled'
  | 'unknown_profile'
  | 'model_directory_missing'
  | 'model_file_missing'
  | 'model_file_checksum_mismatch'
  | 'hotwords_file_missing'
  | 'hotwords_file_invalid'
  | 'sdk_load_failed';

/** 组合结果：要么是可用的 Gateway，要么是稳定 unavailable reason。 */
export interface SherpaStreamingResolution {
  readonly gateway: SherpaStreamingTranscriptionGateway | null;
  readonly reason: SherpaStreamingUnavailableReason | null;
}

/** 文件系统与 SDK 注入点（测试用内存 fake，生产用 node 默认实现）。 */
export interface SherpaStreamingGatewayDependencies {
  isDirectory(path: string): boolean;
  isFile(path: string): boolean;
  sha256File(path: string): Promise<string>;
  readHotwords(path: string): string;
  /** 懒加载 sherpa WASM SDK（CJS require）；只暴露本地 SDK 接口，不泄漏 Provider 模块类型。 */
  loadSdk(): SherpaWasmSdk;
}

const defaultDependencies = {
  isDirectory: (path: string): boolean => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  isFile: (path: string): boolean => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  sha256File: async (path: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(path);
      // chunk 类型跟随 @types/node@22 的 data 事件签名（Buffer | string）；
      // 显式 Buffer 标注在该签名下参数逆变不成立，交由推断，避免类型降级后再引入回归。
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  },
  readHotwords: (path: string): string => readFileSync(path, 'utf8'),
  loadSdk: () => loadSherpaOnnxSdk(),
};

/** 模型目录下的 bpe.vocab 相对名；安装脚本保证其由 bpe.model 确定性导出。 */
const BPE_VOCAB_RELATIVE = 'bpe.vocab';

/**
 * 热词词表内容校验：每行一个热词（可选 `:score` 后缀，score 为正数）；
 * 拒绝空行、控制字符、超长行与超大文件，防止畸形词表在构建
 * Aho-Corasick 自动机时拖垮或注入。严格规则是可测试的 fail-closed 边界。
 */
export function validateSherpaHotwordsText(text: string): boolean {
  if (text.length === 0 || text.length > 64 * 1024) return false;
  const lines = text.split(/\r?\n/);
  // 文件以 \n 结尾时 split 产生尾部空元素，属正常；去掉后再判空。
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0 || lines.length > 1_000) return false;
  for (const line of lines) {
    if (line.trim() === '') return false;
    if (line.length > 200) return false;
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(line)) return false;
    const match = /^([^:]+?)(?::([0-9]+(?:\.[0-9]+)?))?$/.exec(line);
    if (match === null) return false;
    const word = match[1];
    const score = match[2];
    // word 不得为空且不得再次包含 ':'（如 'a:b:c' 非法）。
    if (word === undefined || word.length === 0 || word.includes(':')) {
      return false;
    }
    if (score !== undefined && Number(score) <= 0) return false;
  }
  return true;
}

/** 校验单个必需文件；返回 null 表示通过，否则返回稳定 reason。
 * sha256 读取失败（权限、文件被并发删除）同样归一化为稳定 reason，
 * 保证闸门永远返回 `{ gateway: null, reason }` 而不外泄原始异常。 */
async function verifyModelFile(
  path: string,
  expectedSha256: string,
  deps: SherpaStreamingGatewayDependencies,
): Promise<SherpaStreamingUnavailableReason | null> {
  let fileExists = false;
  try {
    fileExists = deps.isFile(path);
  } catch {
    // 注入依赖抛错（默认实现吞 stat 错误）按缺失归一化。
  }
  if (!fileExists) return 'model_file_missing';
  let actual: string;
  try {
    actual = await deps.sha256File(path);
  } catch {
    return 'model_file_checksum_mismatch';
  }
  return actual === expectedSha256 ? null : 'model_file_checksum_mismatch';
}

/**
 * 唯一组合闸门：全部校验通过才创建 Gateway（SDK 在最后一步懒加载，默认
 * 关闭时不会加载 WASM 运行时）。返回 reason 供审计，但绝不打印路径。
 */
export async function resolveSherpaStreamingTranscriptionGateway(
  environment: ModelGatewayEnvironment,
  deps: SherpaStreamingGatewayDependencies = defaultDependencies,
): Promise<SherpaStreamingResolution> {
  let config: EnabledSherpaStreamingConfiguration;
  try {
    const parsed = parseSherpaStreamingConfiguration(environment);
    if (!parsed.enabled) {
      return { gateway: null, reason: 'streaming_disabled' };
    }
    config = parsed;
  } catch {
    // 配置形状非法 → 不可用，与未启用同样 fail-closed。
    return { gateway: null, reason: 'streaming_disabled' };
  }

  const profile = getSherpaModelProfile(config.profile);
  if (profile === null) return { gateway: null, reason: 'unknown_profile' };

  const modelDir = config.modelDirectory;
  let modelDirIsDirectory = false;
  try {
    modelDirIsDirectory = deps.isDirectory(modelDir);
  } catch {
    // 注入的依赖可能抛错（默认实现吞 stat 错误）；一律归一化。
  }
  if (!modelDirIsDirectory) {
    return { gateway: null, reason: 'model_directory_missing' };
  }

  // 必需文件 = manifest 全部条目（含 bpe.vocab）：真实 SDK 在
  // modelingUnit=cjkchar+bpe 时强制要求 bpeVocab 非空（online-model-config.cc
  // 校验），bpe.vocab 因此总是必需，与是否启用热词无关。
  const requiredFiles = Object.keys(profile.files);
  for (const name of requiredFiles) {
    const filePath = join(modelDir, name);
    const failure = await verifyModelFile(filePath, profile.files[name]!, deps);
    if (failure !== null) return { gateway: null, reason: failure };
  }

  const hotwordsEnabled = config.hotwordsPath !== null;
  if (hotwordsEnabled) {
    if (!profile.hotwordsSupported) {
      return { gateway: null, reason: 'hotwords_file_invalid' };
    }
    const hotwordsPath = config.hotwordsPath!;
    let hotwordsFileExists = false;
    try {
      hotwordsFileExists = deps.isFile(hotwordsPath);
    } catch {
      // 与上同理：注入依赖抛错按缺失归一化。
    }
    if (!hotwordsFileExists) {
      return { gateway: null, reason: 'hotwords_file_missing' };
    }
    let hotwordsText: string;
    try {
      hotwordsText = deps.readHotwords(hotwordsPath);
    } catch {
      return { gateway: null, reason: 'hotwords_file_invalid' };
    }
    if (!validateSherpaHotwordsText(hotwordsText)) {
      return { gateway: null, reason: 'hotwords_file_invalid' };
    }
  }

  // 全部校验通过：懒加载 SDK 并构造唯一 Adapter。SDK 加载失败仍 fail-closed。
  let sdk: SherpaWasmSdk;
  try {
    sdk = deps.loadSdk();
  } catch {
    return { gateway: null, reason: 'sdk_load_failed' };
  }

  // 模型文件路径一律从 manifest 的 files 键派生，不允许硬编码：manifest 改名
  // 时这里会得到 null（fail-closed），而不是把陈旧路径喂给 SDK。
  const requiredFileName = (name: string): string => {
    if (profile.files[name] === undefined) {
      throw new Error('manifest_missing_required_file');
    }
    return name;
  };
  let factory: SherpaWasmRecognizerFactory;
  try {
    factory = new SherpaWasmRecognizerFactory({
      createOnlineRecognizer: sdk.createOnlineRecognizer,
      profile,
      config,
      paths: {
        encoder: join(modelDir, requiredFileName('encoder.int8.onnx')),
        decoder: join(modelDir, requiredFileName('decoder.onnx')),
        joiner: join(modelDir, requiredFileName('joiner.int8.onnx')),
        tokens: join(modelDir, requiredFileName('tokens.txt')),
        bpeVocab: join(modelDir, requiredFileName(BPE_VOCAB_RELATIVE)),
      },
    });
  } catch {
    // manifest 结构异常 → 视为配置不可用，不创建 Adapter。
    return { gateway: null, reason: 'model_file_missing' };
  }

  const gateway = new SherpaStreamingTranscriptionGateway({
    recognizerFactory: factory,
    timeoutMs: config.sessionTimeoutMs,
  });
  return { gateway, reason: null };
}
