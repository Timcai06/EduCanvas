import type { GatewayMessageHistoryEntry } from '@educanvas/gateway-core';
import { describe, expect, it } from 'vitest';
import { toCanonicalMessage } from '../src/main/message-history-projection';

describe('desktop canonical message projection', () => {
  it('keeps a readable artifact title when history contains only an artifact reference', () => {
    const entry: GatewayMessageHistoryEntry = {
      messageId: 'message:artifact',
      clientMessageId: 'desktop:artifact',
      role: 'assistant',
      status: 'completed',
      content: '我已经生成学习材料。',
      parts: [
        {
          type: 'artifact_ref',
          artifactId: 'artifact:mind-map',
          versionId: 'version:one',
          kind: 'mind_map',
        },
      ],
      citations: [],
      createdAt: '2026-08-15T00:00:00.000Z',
      completedAt: '2026-08-15T00:00:01.000Z',
    };

    expect(toCanonicalMessage(entry).parts).toEqual([
      expect.objectContaining({
        type: 'artifact',
        artifactKind: 'mind_map',
        label: '思维导图',
      }),
    ]);
  });
});
