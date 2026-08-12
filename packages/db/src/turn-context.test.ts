import type { AssetVersionRepresentationIdentity } from '@educanvas/agent-core';
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
      selectedAssetRepresentations: [null],
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
      selectedAssetRepresentations: [],
      omittedMessageCount: 0,
      characterCount: 8,
    });
    const reversed = prepareTurnContextMaterial({
      builderVersion: 'conversation-context-v1',
      includedMessageIds: [secondMessageId, firstMessageId],
      selectedAssetVersionIds: [],
      selectedAssetRepresentations: [],
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
        selectedAssetRepresentations: [],
        omittedMessageCount: 0,
        characterCount: 0,
      }),
    ).toThrow(TurnContextConflictError);
    expect(() =>
      prepareTurnContextMaterial({
        builderVersion: 'conversation-context-v1',
        includedMessageIds: [],
        selectedAssetVersionIds: [],
        selectedAssetRepresentations: [],
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
        selectedAssetRepresentations: [],
        omittedMessageCount: 0,
        characterCount: 10,
      }),
    ).toThrow(TurnContextConflictError);
    expect(() =>
      prepareTurnContextMaterial({
        builderVersion: 'conversation-context-v1',
        includedMessageIds: [],
        selectedAssetVersionIds: [assetVersionId, assetVersionId],
        selectedAssetRepresentations: [],
        omittedMessageCount: 0,
        characterCount: 10,
      }),
    ).toThrow(TurnContextConflictError);
  });

  it('多 Asset 版本顺序属于可审计材料（R02 完整追溯）', () => {
    const first = prepareTurnContextMaterial({
      builderVersion: 'conversation-context-v1',
      includedMessageIds: [firstMessageId],
      selectedAssetVersionIds: [
        '20000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
      ],
      selectedAssetRepresentations: [null, null],
      omittedMessageCount: 0,
      characterCount: 10,
    });
    const reversed = prepareTurnContextMaterial({
      builderVersion: 'conversation-context-v1',
      includedMessageIds: [firstMessageId],
      selectedAssetVersionIds: [
        '20000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
      ],
      selectedAssetRepresentations: [null, null],
      omittedMessageCount: 0,
      characterCount: 10,
    });

    expect(reversed.contextHash).not.toBe(first.contextHash);
    expect(first.selectedAssetVersionIds).toEqual([
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
    ]);
  });

  it('表示身份纳入 hash：同一材料不同表示 → 不同 hash（ADR-0026 第 5 节）', () => {
    const identity = {
      kind: 'text' as const,
      quality: 'structured' as const,
      variant: 'default',
      producer: 'mineru',
      producerVersion: 'mineru.v1',
    };
    const base = {
      builderVersion: 'conversation-context-v1',
      includedMessageIds: [firstMessageId],
      selectedAssetVersionIds: [assetVersionId],
      omittedMessageCount: 0,
      characterCount: 10,
    };
    const without = prepareTurnContextMaterial({
      ...base,
      selectedAssetRepresentations: [null],
    });
    const withIdentity = prepareTurnContextMaterial({
      ...base,
      selectedAssetRepresentations: [identity],
    });

    expect(withIdentity.contextHash).not.toBe(without.contextHash);
    expect(withIdentity.selectedAssetRepresentations).toEqual([identity]);
  });

  it('表示身份数量必须与 Asset 版本同数，否则拒绝', () => {
    expect(() =>
      prepareTurnContextMaterial({
        builderVersion: 'conversation-context-v1',
        includedMessageIds: [firstMessageId],
        selectedAssetVersionIds: [assetVersionId],
        selectedAssetRepresentations: [],
        omittedMessageCount: 0,
        characterCount: 10,
      }),
    ).toThrow(TurnContextConflictError);
    expect(() =>
      prepareTurnContextMaterial({
        builderVersion: 'conversation-context-v1',
        includedMessageIds: [firstMessageId],
        selectedAssetVersionIds: [assetVersionId],
        selectedAssetRepresentations: [null, null],
        omittedMessageCount: 0,
        characterCount: 10,
      }),
    ).toThrow(TurnContextConflictError);
  });

  it('非法表示身份字段（开放 Vocabulary 越界）→ 拒绝', () => {
    const base = {
      builderVersion: 'conversation-context-v1',
      includedMessageIds: [firstMessageId],
      selectedAssetVersionIds: [assetVersionId],
      omittedMessageCount: 0,
      characterCount: 10,
    };
    /* 运行时校验的对象：开放 Vocabulary 只在格式层约束，测试故意构造越界值，
       通过 unknown 断言绕过字面量类型检查。 */
    const identityWith = (overrides: Record<string, unknown>) =>
      ({
        kind: 'text',
        quality: 'structured',
        variant: 'default',
        producer: 'mineru',
        producerVersion: 'mineru.v1',
        ...overrides,
      }) as unknown;
    for (const broken of [
      { variant: 'Default' },
      { producer: 'mineru!' },
      { producerVersion: '-v1' },
      { quality: 'raw_text' },
      { kind: 'ocr' },
    ]) {
      expect(() =>
        prepareTurnContextMaterial({
          ...base,
          /* 运行时校验的对象：identityWith 故意返回未知形状，绕过字面量类型。 */
          selectedAssetRepresentations: [
            identityWith(broken),
          ] as unknown as (AssetVersionRepresentationIdentity | null)[],
        }),
      ).toThrow(TurnContextConflictError);
    }
  });
});
