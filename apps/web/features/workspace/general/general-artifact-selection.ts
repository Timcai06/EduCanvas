import type { AssetItem } from '@/features/assets/assets-drawer';
import type {
  ArtifactDetail,
  ArtifactSourceReference,
} from '@/features/canvas/artifact-client';
import type { GenerationState } from '@/features/canvas/artifact-generation-flow';

/** 只有已启用且有不可变版本的文档/网页可成为音频概览来源。 */
export function selectAudioArtifactSources(
  notebookSources: readonly AssetItem[],
): readonly ArtifactSourceReference[] {
  return notebookSources.flatMap((asset) =>
    asset.enabled &&
    asset.versionId &&
    (asset.kind === 'document' || asset.kind === 'link')
      ? [
          {
            assetId: asset.id,
            versionId: asset.versionId,
            kind: asset.kind,
          } as const,
        ]
      : [],
  );
}

/** 当前 Canvas 正在生成同一 Artifact 的新版本时，状态卡不能被关闭。 */
export function isArtifactRevisionInProgress(input: {
  openDetail: ArtifactDetail | null;
  generation: GenerationState | null;
}): boolean {
  return Boolean(
    input.openDetail &&
    ((input.generation?.phase === 'generating' &&
      input.generation.artifactId === input.openDetail.artifact.id) ||
      ['queued', 'running'].includes(input.openDetail.latestJob?.status ?? '')),
  );
}
