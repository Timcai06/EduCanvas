import {
  projectCanvasResourceForNonWeb,
  type CanvasNonWebProjection,
} from '@educanvas/canvas-protocol';
import type { TuiCanvasOpenResult } from './canvas-client';

const STATUS_LABELS = {
  processing: '处理中',
  ready: '可查看',
  failed: '处理失败',
  unavailable: '暂不可用',
  archived: '已归档',
} as const;

export interface TuiCanvasListEntry {
  readonly index: number;
  readonly projection: CanvasNonWebProjection;
}

/** 列表只展示 CanvasResource 已审查字段；跨 Notebook 条目保持匿名不可用。 */
export function createTuiCanvasList(
  resources: readonly unknown[],
  currentNotebookId: string,
): readonly TuiCanvasListEntry[] {
  return resources.slice(0, 100).map((resource, offset) => ({
    index: offset + 1,
    projection: projectCanvasResourceForNonWeb({
      resource,
      currentNotebookId,
    }),
  }));
}

export function renderTuiCanvasList(
  entries: readonly TuiCanvasListEntry[],
): string {
  if (entries.length === 0) return '当前笔记本还没有 Canvas 资源。\n';
  return `${entries
    .map(({ index, projection }) => {
      if (!projection.available) return `  ${index}. Canvas 资源不可用`;
      const action =
        projection.openMode === 'inline_text'
          ? '可在终端打开'
          : projection.openMode === 'web_handoff'
            ? '需在 Web 打开'
            : '不可打开';
      return `  ${index}. ${projection.title} · ${STATUS_LABELS[projection.status]} · ${action}`;
    })
    .join('\n')}\n`;
}

export function renderTuiCanvasOpen(result: TuiCanvasOpenResult): string {
  switch (result.kind) {
    case 'inline_text':
      return `\n${result.title}\n${result.text}\n`;
    case 'web_handoff':
      return `已创建短期一次性 Web 交接：${result.url}\n`;
    case 'unavailable':
      return '这个 Canvas 资源当前不可用或没有访问权限。\n';
  }
}
