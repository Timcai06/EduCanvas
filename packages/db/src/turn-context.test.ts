import { describe, expect, it } from 'vitest';
import {
  TurnContextConflictError,
  prepareTurnContextMaterial,
} from './turn-context';

const firstMessageId = '10000000-0000-4000-8000-000000000001';
const secondMessageId = '10000000-0000-4000-8000-000000000002';
const assetVersionId = '10000000-0000-4000-8000-000000000003';

describe('prepareTurnContextMaterial', () => {
  it('为相同清单生成稳定hash且不修改调用方数组', () => {
    const includedMessageIds = [firstMessageId, secondMessageId];
    const input = {
      builderVersion: 'conversation-context-v1',
      includedMessageIds,
      selectedAssetVersionIds: [assetVersionId],
      omittedMessageCount: 2,
      characterCount: 128,
    };

    const first = prepareTurnContextMaterial(input);
    const second = prepareTurnContextMaterial(input);

    expect(first.contextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.contextHash).toBe(first.contextHash);
    expect(first.includedMessageIds).not.toBe(includedMessageIds);
    expect(includedMessageIds).toEqual([firstMessageId, secondMessageId]);
  });

  it('消息选择顺序属于可审计材料', () => {
    const original = prepareTurnContextMaterial({
      builderVersion: 'conversation-context-v1',
      includedMessageIds: [firstMessageId, secondMessageId],
      selectedAssetVersionIds: [],
      omittedMessageCount: 0,
      characterCount: 8,
    });
    const reversed = prepareTurnContextMaterial({
      builderVersion: 'conversation-context-v1',
      includedMessageIds: [secondMessageId, firstMessageId],
      selectedAssetVersionIds: [],
      omittedMessageCount: 0,
      characterCount: 8,
    });

    expect(reversed.contextHash).not.toBe(original.contextHash);
  });

  it('拒绝非法标识和越界计数', () => {
    expect(() =>
      prepareTurnContextMaterial({
        builderVersion: 'conversation-context-v1',
        includedMessageIds: ['not-a-uuid'],
        selectedAssetVersionIds: [],
        omittedMessageCount: 0,
        characterCount: 0,
      }),
    ).toThrow(TurnContextConflictError);
    expect(() =>
      prepareTurnContextMaterial({
        builderVersion: 'conversation-context-v1',
        includedMessageIds: [],
        selectedAssetVersionIds: [],
        omittedMessageCount: -1,
        characterCount: 0,
      }),
    ).toThrow(TurnContextConflictError);
  });

  it('拒绝重复消息或Asset版本，避免同一上下文重复计费', () => {
    expect(() =>
      prepareTurnContextMaterial({
        builderVersion: 'conversation-context-v1',
        includedMessageIds: [firstMessageId, firstMessageId],
        selectedAssetVersionIds: [],
        omittedMessageCount: 0,
        characterCount: 10,
      }),
    ).toThrow(TurnContextConflictError);
  });
});
