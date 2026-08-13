import type { AgentAssetPart, AssetKind } from '@educanvas/agent-core';

export const TURN_CONTEXT_ASSET_LIMIT = 63 as const;

export type TurnContextOmissionReason =
  'processing' | 'failed' | 'unavailable' | 'disabled' | 'limit' | 'duplicate';

/** Source list 与 Live 视图共享的最小输入；正文、存储地址和 Provider 数据不进入快照。 */
export interface TurnContextAssetInput {
  readonly id: string;
  readonly versionId: string | null;
  readonly label: string;
  readonly kind: string;
  readonly scope: 'turn' | 'space';
  readonly status: 'pending' | 'processing' | 'ready' | 'failed' | 'tombstoned';
  readonly enabled: boolean;
  readonly selectable: boolean;
}

export interface TurnContextSnapshotEntry extends TurnContextAssetInput {
  readonly included: boolean;
  readonly reason: TurnContextOmissionReason | null;
  readonly usage: 'context' | 'attachment';
}

export interface TurnContextSnapshot {
  readonly entries: readonly TurnContextSnapshotEntry[];
  readonly included: readonly TurnContextSnapshotEntry[];
  readonly omitted: readonly TurnContextSnapshotEntry[];
  readonly parts: readonly AgentAssetPart[];
}

const supportedKinds = new Set<AssetKind>([
  'image',
  'document',
  'link',
  'audio',
  'video',
]);

function omissionReason(
  asset: TurnContextAssetInput,
): TurnContextOmissionReason | null {
  if (!asset.enabled) return 'disabled';
  if (asset.status === 'pending' || asset.status === 'processing')
    return 'processing';
  if (asset.status === 'failed') return 'failed';
  if (
    asset.status !== 'ready' ||
    asset.versionId === null ||
    !asset.selectable ||
    !supportedKinds.has(asset.kind as AssetKind)
  )
    return 'unavailable';
  return null;
}

/** 普通 Turn 与 Live ASR final 共用的有界、稳定、不可变版本快照。 */
export function buildTurnContextSnapshot(
  assets: readonly TurnContextAssetInput[],
): TurnContextSnapshot {
  const seen = new Set<string>();
  let includedCount = 0;
  const entries: TurnContextSnapshotEntry[] = [];

  for (const asset of assets) {
    const key = `${asset.id}:${asset.versionId ?? ''}`;
    let reason = omissionReason(asset);
    if (reason === null && seen.has(key)) reason = 'duplicate';
    if (reason === null && includedCount >= TURN_CONTEXT_ASSET_LIMIT)
      reason = 'limit';
    if (reason === null) {
      seen.add(key);
      includedCount += 1;
    }
    entries.push({
      ...asset,
      usage: asset.scope === 'space' ? 'context' : 'attachment',
      included: reason === null,
      reason,
    });
  }

  const included = entries.filter((entry) => entry.included);
  const omitted = entries.filter((entry) => !entry.included);
  const parts: AgentAssetPart[] = included.map((entry) => ({
    type: 'asset_ref',
    reference: {
      assetId: entry.id,
      versionId: entry.versionId!,
      kind: entry.kind as AssetKind,
    },
    usage: entry.usage,
  }));
  return { entries, included, omitted, parts };
}
