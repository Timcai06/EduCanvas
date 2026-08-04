import { projectTelegramCanvasResource } from '@educanvas/channel-telegram';
import type { CanvasResource } from '@educanvas/canvas-protocol';
import type { GatewayOperationEvent } from '@educanvas/gateway-core';

export interface TelegramCanvasDeliveryContext {
  readonly userId: string;
  readonly notebookId: string;
}

export type TelegramCanvasResourceLoader = (input: {
  readonly userId: string;
  readonly notebookId: string;
  readonly artifactId: string;
}) => Promise<CanvasResource | null>;

/** 每轮最多投影十个 Artifact；加载失败按不可见处理，不把服务端异常发给渠道。 */
export async function telegramCanvasSummaries(
  events: readonly GatewayOperationEvent[],
  context: TelegramCanvasDeliveryContext,
  loadResource: TelegramCanvasResourceLoader,
): Promise<readonly string[]> {
  const artifactIds = [
    ...new Set(
      events.flatMap((event) =>
        event.type === 'artifact.proposed' ||
        event.type === 'artifact.version_added' ||
        event.type === 'artifact.generation_progress' ||
        event.type === 'artifact.failed'
          ? [event.artifactId]
          : [],
      ),
    ),
  ].slice(0, 10);

  const summaries: string[] = [];
  for (const artifactId of artifactIds) {
    try {
      const resource = await loadResource({ ...context, artifactId });
      if (!resource) continue;
      summaries.push(
        projectTelegramCanvasResource({
          resource,
          currentNotebookId: context.notebookId,
        }),
      );
    } catch {
      // 渠道投影失败不能暴露数据库或投影异常，也不能影响原始回答文本投递。
    }
  }
  return summaries;
}
