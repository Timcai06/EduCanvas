import { buildTurnContextSnapshot } from '@/features/chat/turn-context-snapshot';

export type LiveVoiceAssetKind =
  'image' | 'document' | 'link' | 'audio' | 'video';

/** 消息保留 1 个文本 Part，因此 64 Parts 契约允许最多 63 个资料引用。 */
export const MAX_LIVE_CONTEXT_ASSETS = 63;

export interface LiveVoiceContextAsset {
  readonly id: string;
  /** ASR final 时冻结不可变版本；服务端仍会重新验证归属、权限与当前版本。 */
  readonly versionId: string | null;
  readonly label: string;
  readonly kind: LiveVoiceAssetKind;
  readonly scope: 'turn' | 'space';
  readonly status: 'pending' | 'processing' | 'ready' | 'failed' | 'tombstoned';
  readonly enabled: boolean;
  readonly selectable: boolean;
  /** 仅允许同源、已鉴权的预览地址；对象存储键永远不进入该结构。 */
  readonly previewUrl?: string | null;
}

export interface LiveVoiceArtifactItem {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: 'proposed' | 'active' | 'archived' | 'generating' | 'failed';
  readonly previewUrl?: string | null;
}

export interface LiveVoiceCitationItem {
  readonly id: string;
  readonly label: string;
  readonly pageStart?: number | null;
  readonly pageEnd?: number | null;
}

export interface LiveVoiceToolItem {
  readonly id: string;
  readonly label: string;
  readonly status: 'running' | 'completed' | 'failed';
}

/** ASR final 时由当前 UI 事实冻结；Turn 仍在服务端重新验证版本与 Notebook 权限。 */
export interface LiveVoiceContextSnapshot {
  readonly capturedAt: number;
  readonly assets: readonly LiveVoiceContextAsset[];
}

export function freezeLiveVoiceContext(
  assets: readonly LiveVoiceContextAsset[],
  now = Date.now(),
): LiveVoiceContextSnapshot {
  const decision = buildTurnContextSnapshot(assets);
  return {
    capturedAt: now,
    assets: assets
      .filter((_, index) => decision.entries[index]?.included === true)
      .map((asset) => ({ ...asset })),
  };
}

export function liveVoiceAssetStatusLabel(
  asset: LiveVoiceContextAsset,
): string {
  if (asset.status === 'ready') {
    return asset.scope === 'space' ? '长期上下文' : '仅本轮';
  }
  if (asset.status === 'pending' || asset.status === 'processing') {
    return '处理中 · 本轮暂不带入';
  }
  if (asset.status === 'failed') return '处理失败';
  return '不可用';
}
