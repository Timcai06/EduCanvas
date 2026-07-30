import type { TeachingTurnEvent } from '@/features/chat/turn-events';
import { createSseEventStream } from './sse';

/**
 * 断开浏览器连接只停止写入响应，不把网络断开误当成学生点击“停止”。
 * 后台生成仍会完成持久化；显式停止必须调用 turn/:id/cancel。
 */
export function createTeachingTurnEventStream(
  events: AsyncIterable<TeachingTurnEvent>,
): ReadableStream<Uint8Array> {
  return createSseEventStream(events);
}
