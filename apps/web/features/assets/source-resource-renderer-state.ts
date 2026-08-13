import type { CanvasResource } from '@educanvas/canvas-protocol';
import type { CanvasResourceClientErrorKind } from '../canvas/canvas-resource-client';
import type { AssetPreview } from './asset-preview-contract';

export type SourceRendererState =
  | 'loading'
  | 'empty'
  | 'ready'
  | 'failed'
  | 'unavailable'
  | 'forbidden'
  | 'not_found'
  | 'offline';

export interface SourceRendererStateInfo {
  readonly state: SourceRendererState;
  readonly error: CanvasResourceClientErrorKind | null;
  readonly errorMessage: string | null;
}

export function shouldPollSourceResource(resource: CanvasResource): boolean {
  return resource.status === 'processing';
}

export function canLoadSourcePreview(resource: CanvasResource): boolean {
  return (
    resource.status === 'ready' &&
    resource.version !== null &&
    resource.allowedActions.includes('view')
  );
}

export function resolveSourceRendererState(
  resource: CanvasResource,
  preview: AssetPreview | null,
  previewError: CanvasResourceClientErrorKind | null,
): SourceRendererStateInfo {
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

  if (
    resource.status === 'ready' &&
    !resource.allowedActions.includes('view')
  ) {
    return {
      state: 'forbidden',
      error: 'forbidden',
      errorMessage: '没有权限预览这个来源。',
    };
  }

  if (previewError) {
    const messages: Record<CanvasResourceClientErrorKind, string> = {
      forbidden: '没有权限预览这个来源。',
      not_found: '这个来源不存在或已被删除。',
      offline: '网络连接不可用，请检查网络后重试。',
      unavailable: '来源预览服务暂时不可用。',
      failed: '暂时无法预览这个来源。',
    };
    return {
      state: previewError,
      error: previewError,
      errorMessage: messages[previewError],
    };
  }

  if (resource.status === 'processing') {
    return {
      state: 'loading',
      error: null,
      errorMessage: null,
    };
  }

  if (
    preview &&
    (preview.kind === 'markdown' || preview.kind === 'text') &&
    preview.content.trim().length === 0
  ) {
    return {
      state: 'empty',
      error: null,
      errorMessage: '这个来源没有可预览内容。',
    };
  }
  /* DOCX structured 时服务端不跑 mammoth（content 为空是预期），只要派生文本
     可读就不是"无内容"；degraded 时 mammoth 已跑，content 非空走正常分支。 */
  if (
    preview &&
    preview.kind === 'docx' &&
    preview.content.trim().length === 0 &&
    !(
      preview.representation?.quality === 'structured' ||
      preview.representation?.quality === 'degraded_plain_text'
    )
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
