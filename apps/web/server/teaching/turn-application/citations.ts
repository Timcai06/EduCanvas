import 'server-only';

import type { TurnApplicationProfileEvent } from '@educanvas/agent-runtime';
import type { MessageCitationSnapshot } from '@educanvas/db';

/** 将教学知识引用映射为稳定的 Turn Application 引用事件。 */
export function createWebTeachingCitationEvent(
  operationId: string,
  citation: MessageCitationSnapshot,
): TurnApplicationProfileEvent {
  const pageLabel = citation.pageStart
    ? citation.pageEnd && citation.pageEnd !== citation.pageStart
      ? ` · 第${citation.pageStart}-${citation.pageEnd}页`
      : ` · 第${citation.pageStart}页`
    : '';
  return {
    protocol: 'educanvas.turn.v2',
    operationId,
    type: 'message.citation',
    messageId: citation.assistantMessageId,
    citationId: citation.id,
    marker: citation.ordinal,
    label: [...`${citation.sourceTitle}${pageLabel}`].slice(0, 160).join(''),
    target: {
      kind: 'knowledge',
      sourceId: citation.sourceId,
      documentId: citation.documentId,
      chunkId: citation.chunkId,
      pageStart: citation.pageStart,
      pageEnd: citation.pageEnd,
    },
  };
}
