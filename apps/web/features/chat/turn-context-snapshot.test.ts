import { describe, expect, it } from 'vitest';
import {
  TURN_CONTEXT_ASSET_LIMIT,
  buildTurnContextSnapshot,
  type TurnContextAssetInput,
} from './turn-context-snapshot';

function asset(
  id: string,
  overrides: Partial<TurnContextAssetInput> = {},
): TurnContextAssetInput {
  return {
    id,
    versionId: `${id}-v1`,
    label: id,
    kind: 'document',
    scope: 'space',
    status: 'ready',
    enabled: true,
    selectable: true,
    ...overrides,
  };
}

describe('buildTurnContextSnapshot', () => {
  it('普通与 Live 共同支持五类 kind，并按 scope 生成 usage', () => {
    const snapshot = buildTurnContextSnapshot([
      asset('image', { kind: 'image' }),
      asset('doc', { kind: 'document', scope: 'turn' }),
      asset('link', { kind: 'link' }),
      asset('audio', { kind: 'audio' }),
      asset('video', { kind: 'video' }),
    ]);
    expect(snapshot.parts.map((part) => part.reference.kind)).toEqual([
      'image',
      'document',
      'link',
      'audio',
      'video',
    ]);
    expect(snapshot.parts.map((part) => part.usage)).toEqual([
      'context',
      'attachment',
      'context',
      'context',
      'context',
    ]);
  });

  it('稳定报告 disabled、processing、failed、unavailable 与 duplicate', () => {
    const snapshot = buildTurnContextSnapshot([
      asset('disabled', { enabled: false }),
      asset('processing', { status: 'processing' }),
      asset('failed', { status: 'failed' }),
      asset('missing', { versionId: null }),
      asset('not-selectable', { selectable: false }),
      asset('unknown', { kind: 'spreadsheet' }),
      asset('duplicate'),
      asset('duplicate'),
    ]);
    expect(snapshot.omitted.map((entry) => entry.reason)).toEqual([
      'disabled',
      'processing',
      'failed',
      'unavailable',
      'unavailable',
      'unavailable',
      'duplicate',
    ]);
    expect(snapshot.parts).toHaveLength(1);
  });

  it('最多输出 63 个引用，超出的有效资源明确标记 limit', () => {
    const snapshot = buildTurnContextSnapshot(
      Array.from({ length: TURN_CONTEXT_ASSET_LIMIT + 2 }, (_, index) =>
        asset(`asset-${index}`),
      ),
    );
    expect(snapshot.parts).toHaveLength(TURN_CONTEXT_ASSET_LIMIT);
    expect(snapshot.omitted.map((entry) => entry.reason)).toEqual([
      'limit',
      'limit',
    ]);
  });
});
