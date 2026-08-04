import type { CanvasResource, CanvasResourceKind } from './resource';
import { canvasResourceSchema } from './resource';

export const canvasNonWebOpenModes = [
  'inline_text',
  'web_handoff',
  'none',
] as const;

export type CanvasNonWebOpenMode = (typeof canvasNonWebOpenModes)[number];

export const canvasNonWebUnavailableReasons = [
  'resource_not_found',
  'resource_invalid',
] as const;

export type CanvasNonWebUnavailableReason =
  (typeof canvasNonWebUnavailableReasons)[number];

export type CanvasNonWebProjection =
  | {
      readonly available: true;
      readonly resourceId: string;
      readonly resourceKind: CanvasResourceKind;
      readonly title: string;
      readonly status: CanvasResource['status'];
      readonly representationKind: CanvasResource['representation']['kind'];
      readonly mimeType: string;
      readonly runtimeKind: CanvasResource['runtime']['kind'];
      readonly openMode: CanvasNonWebOpenMode;
    }
  | {
      readonly available: false;
      readonly reason: CanvasNonWebUnavailableReason;
    };

/**
 * 把公共 CanvasResource 收敛为非 Web 客户端可以安全消费的最小判定。
 *
 * 此函数故意不投影 Notebook ID、checksum、provenance、生成摘要或任何内容地址。
 * Notebook 不匹配与非法输入统一隐藏成不可用，调用方不能借此探测资源存在性。
 */
export function projectCanvasResourceForNonWeb(input: {
  readonly resource: unknown;
  readonly currentNotebookId: string;
}): CanvasNonWebProjection {
  const parsed = canvasResourceSchema.safeParse(input.resource);
  if (!parsed.success) {
    return { available: false, reason: 'resource_invalid' };
  }
  const resource = parsed.data;
  if (resource.notebookId !== input.currentNotebookId) {
    return { available: false, reason: 'resource_not_found' };
  }

  let openMode: CanvasNonWebOpenMode = 'none';
  if (resource.status === 'ready' && resource.allowedActions.includes('view')) {
    openMode =
      resource.runtime.kind === 'none' &&
      resource.representation.kind === 'text'
        ? 'inline_text'
        : 'web_handoff';
  }

  return {
    available: true,
    resourceId: resource.resourceId,
    resourceKind: resource.resourceKind,
    title: resource.title,
    status: resource.status,
    representationKind: resource.representation.kind,
    mimeType: resource.representation.mimeType,
    runtimeKind: resource.runtime.kind,
    openMode,
  };
}
