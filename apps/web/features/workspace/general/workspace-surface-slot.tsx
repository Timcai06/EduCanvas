'use client';

import type { ComponentType } from 'react';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import type { CanvasResourceRendererProps } from '@/features/canvas/canvas-resource-registry';
import type { ArtifactDetail } from '@/features/canvas/artifact-client';
import { ArtifactCanvas } from '@/features/canvas/artifact-generation-flow';
import { HtmlPreviewPanel } from '@/features/canvas/html-preview-panel';
import { SourceResourceRenderer } from '@/features/assets/source-resource-renderer';
import type { WorkspaceSurface } from './workspace-surface';

/** Source 工作面详情：CanvasResource + 注册的 Renderer。 */
export interface SourceSurfaceDetail {
  readonly resource: CanvasResource;
  readonly Renderer: ComponentType<CanvasResourceRendererProps>;
}

/**
 * 按 `WorkspaceSurface` 判别联合渲染唯一工作面（W02）。
 *
 * 组件不持有互斥状态，只根据 surface.type 分发到对应 Renderer：
 * - artifact → `ArtifactCanvas`（详情未就绪时返回 null）；
 * - source → `SourceResourceRenderer`（详情未就绪时返回 null）；
 * - html → `HtmlPreviewPanel`；
 * - none / studio / loading / failed → null（studio 由 overlay 单独渲染）。
 *
 * `fullscreen` 为 landing 态全屏打开：isFull 恒真、toggle 为 no-op，
 * 与对话态分栏共用同一渲染逻辑。
 */
export interface WorkspaceSurfaceSlotProps {
  readonly surface: WorkspaceSurface;
  readonly sourceDetail: SourceSurfaceDetail | null;
  readonly artifactDetail: ArtifactDetail | null;
  readonly artifactCanvasFull: boolean;
  readonly revisingOpenArtifact: boolean;
  readonly fullscreen: boolean;
  readonly onToggleFullSurface: () => void;
  readonly onToggleFullArtifact: () => void;
  readonly onCloseSurface: () => void;
  readonly onCloseArtifact: () => void;
  readonly onDeletedArtifact: (artifactId: string) => void;
  readonly onSelectArtifactVersion: (
    artifactId: string,
    version: number,
  ) => void;
  readonly onReviseArtifact: (
    detail: ArtifactDetail,
    instruction: string,
  ) => void;
  readonly onSaveNote: (detail: ArtifactDetail, markdown: string) => void;
}

export function WorkspaceSurfaceSlot({
  surface,
  sourceDetail,
  artifactDetail,
  artifactCanvasFull,
  revisingOpenArtifact,
  fullscreen,
  onToggleFullSurface,
  onToggleFullArtifact,
  onCloseSurface,
  onCloseArtifact,
  onDeletedArtifact,
  onSelectArtifactVersion,
  onReviseArtifact,
  onSaveNote,
}: WorkspaceSurfaceSlotProps) {
  switch (surface.type) {
    case 'artifact': {
      if (artifactDetail === null) return null;
      return (
        <ArtifactCanvas
          detail={artifactDetail}
          isFull={fullscreen || artifactCanvasFull}
          onToggleFull={fullscreen ? () => undefined : onToggleFullArtifact}
          onClose={onCloseArtifact}
          onDeleted={onDeletedArtifact}
          onSelectVersion={(version) =>
            onSelectArtifactVersion(artifactDetail.artifact.id, version)
          }
          onRevise={(instruction) =>
            onReviseArtifact(artifactDetail, instruction)
          }
          onSaveNote={(markdown) => onSaveNote(artifactDetail, markdown)}
          revising={revisingOpenArtifact}
        />
      );
    }
    case 'source': {
      if (sourceDetail === null) return null;
      return (
        <SourceResourceRenderer
          key={`${sourceDetail.resource.resourceId}:${sourceDetail.resource.version?.versionId ?? 'none'}`}
          resource={sourceDetail.resource}
          Renderer={sourceDetail.Renderer}
          isFull={fullscreen || surface.full}
          onToggleFull={fullscreen ? () => undefined : onToggleFullSurface}
          onClose={onCloseSurface}
        />
      );
    }
    case 'html':
      return (
        <HtmlPreviewPanel
          source={surface.source}
          isFull={fullscreen || surface.full}
          onToggleFull={fullscreen ? () => undefined : onToggleFullSurface}
          onClose={onCloseSurface}
        />
      );
    default:
      return null;
  }
}
