import type { CanvasResource } from '@educanvas/canvas-protocol';
import type { CanvasResourceClientErrorKind } from '../canvas/canvas-resource-client';
import type { AssetPreview } from './asset-preview-contract';

export type SourceRendererState =
  'loading' | 'empty' | 'ready' | 'failed' | 'unavailable' | 'denied';

export interface SourceRendererStateInfo {
  readonly state: SourceRendererState;
  readonly error: CanvasResourceClientErrorKind | null;
  readonly errorMessage: string | null;
}

export function resolveSourceRendererState(
  resource: CanvasResource,
  preview: AssetPreview | null,
  previewFailed: boolean,
): SourceRendererStateInfo {
  if (resource.status === 'processing') {
    return {
      state: 'loading',
      error: null,
      errorMessage: null,
    };
  }

  if (resource.status === 'failed') {
    return {
      state: 'failed',
      error: 'failed',
      errorMessage: '这个来源处理失败，暂时没有可预览内容。',
    };
  }

  if (resource.status === 'unavailable') {
    return {
      state: 'unavailable',
      error: 'unavailable',
      errorMessage: '这个来源不可用。',
    };
  }

  if (resource.status === 'archived') {
    return {
      state: 'unavailable',
      error: 'unavailable',
      errorMessage: '这个来源已归档。',
    };
  }

  if (!resource.allowedActions.includes('view')) {
    return {
      state: 'denied',
      error: 'denied',
      errorMessage: '没有权限预览这个来源。',
    };
  }

  if (previewFailed) {
    return {
      state: 'failed',
      error: 'failed',
      errorMessage: '暂时无法预览这个来源。',
    };
  }

  if (
    preview &&
    (preview.kind === 'markdown' ||
      preview.kind === 'text' ||
      preview.kind === 'docx') &&
    preview.content.trim().length === 0
  ) {
    return {
      state: 'empty',
      error: null,
      errorMessage: '这个来源没有可预览内容。',
    };
  }

  if (preview) {
    return {
      state: 'ready',
      error: null,
      errorMessage: null,
    };
  }

  return {
    state: 'loading',
    error: null,
    errorMessage: null,
  };
}
