import type { GatewayMessageHistoryEntry } from '@educanvas/gateway-core';
import type {
  DesktopCanonicalMessage,
  DesktopMessagePart,
} from '../shared/chat-history';

export function toCanonicalMessage(
  entry: GatewayMessageHistoryEntry,
): DesktopCanonicalMessage {
  return {
    messageId: entry.messageId,
    clientMessageId: entry.clientMessageId,
    role: entry.role,
    status: entry.status,
    content: entry.content,
    createdAt: entry.createdAt,
    parts: entry.parts.flatMap(projectMessagePart),
    citations: entry.citations,
  };
}

function projectMessagePart(
  part: GatewayMessageHistoryEntry['parts'][number],
): DesktopMessagePart[] {
  if (part.type === 'text') return [];
  if (part.type === 'artifact_ref') {
    return [
      {
        type: 'artifact',
        artifactId: part.artifactId,
        versionId: part.versionId,
        artifactKind: part.kind,
        label: '生成内容',
      },
    ];
  }
  if (part.reference.kind === 'image') {
    return [
      {
        type: 'image',
        assetId: part.reference.assetId,
        versionId: part.reference.versionId,
        label: '图片',
      },
    ];
  }
  return [
    {
      type: 'unsupported',
      partType: `asset_ref:${part.reference.kind}`,
      label: `${assetKindLabel(part.reference.kind)}内容`,
      target: {
        kind: 'asset',
        assetId: part.reference.assetId,
        assetVersionId: part.reference.versionId,
      },
    },
  ];
}

function assetKindLabel(kind: string): string {
  return (
    {
      audio: '音频',
      video: '视频',
      document: '文档',
      data: '数据',
      link: '链接',
      other: '其他',
    }[kind] ?? '其他'
  );
}
