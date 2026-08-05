/**
 * sherpa 模型 manifest 的 TypeScript 侧类型桥（V09-B）。
 *
 * 唯一事实源是 `tooling/sherpa-model-manifest.json`：tooling 的按需获取脚本与
 * model-gateway 的 fail-closed 闸门读取同一份数据，避免下载方与校验方各持
 * 一份 checksum 导致漂移。本模块只做类型化导入与只读访问，不做任何校验。
 *
 * manifest 是只读白名单：未知 profile 一律查不到（`getSherpaModelProfile`
 * 返回 null），解析与闸门据此显式拒绝，绝不猜测模型来源。
 */
import sherpaModelManifest from '../../../tooling/sherpa-model-manifest.json';

/** 单个受控 profile：下载地址、archive/文件级 SHA-256 与推理参数全部冻结。 */
export interface SherpaModelProfile {
  readonly profileId: string;
  readonly archive: {
    readonly url: string;
    readonly sha256: string;
    readonly bytes: number;
  };
  /** archive 解压后的顶层目录名（部署方把该目录路径配置为 MODEL_DIR）。 */
  readonly directory: string;
  /** 必需文件（相对目录）→ SHA-256；bpe.vocab 是安装脚本从 bpe.model 衍生的。 */
  readonly files: Readonly<Record<string, string>>;
  /** 解码方法（greedy_search / modified_beam_search），消费方按 SDK 字面量收窄。 */
  readonly decodingMethod: string;
  /** 建模单元（cjkchar / cjkchar+bpe / bpe），消费方按 SDK 字面量收窄。 */
  readonly modelingUnit: string;
  readonly maxActivePaths: number;
  readonly hotwordsSupported: boolean;
}

/** 只读白名单：profileId → profile。 */
export const sherpaModelProfiles: Readonly<Record<string, SherpaModelProfile>> =
  sherpaModelManifest.profiles;

/** 按 profileId 取 profile；未知 profile 返回 null（显式拒绝，不猜测）。 */
export function getSherpaModelProfile(
  profileId: string,
): SherpaModelProfile | null {
  const profile = sherpaModelProfiles[profileId];
  return profile === undefined ? null : profile;
}
