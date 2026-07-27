import { describe, expect, it } from 'vitest';
import type { AssetItem } from '@/features/assets/assets-drawer';
import type { ArtifactSummary } from '@/features/canvas/artifact-client';
import { itemsForRoute } from './studio-workspace-options';

function source(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    id: 'asset-1',
    versionId: 'version-1',
    label: '光合作用讲义.pdf',
    kind: 'document',
    scope: 'space',
    status: 'ready',
    enabled: true,
    selectable: true,
    resource: null,
    ...overrides,
  };
}

function output(overrides: Partial<ArtifactSummary> = {}): ArtifactSummary {
  return {
    id: 'artifact-1',
    kind: 'mind_map',
    trustTier: 'tier1',
    title: '光合作用脉络',
    status: 'active',
    latestVersion: 2,
    ...overrides,
  };
}

describe('itemsForRoute', () => {
  it('uses the real entity id so the wheel key survives list reordering', () => {
    const [item] = itemsForRoute('source-browse', [source()], []);

    expect(item?.id).toBe('asset-1');
    expect(item?.label).toBe('光合作用讲义.pdf');
  });

  it('keeps status out of the label so screen readers do not read it as the name', () => {
    const [item] = itemsForRoute('source-browse', [source()], []);

    expect(item?.label).not.toContain('已用于对话');
    expect(item?.secondary).toBe('已用于对话');
  });

  it('marks the empty placeholder disabled so confirming it cannot open anything', () => {
    expect(itemsForRoute('source-browse', [], [])).toEqual([
      { id: 'studio-empty', label: '暂无来源', disabled: true },
    ]);
    expect(itemsForRoute('output-browse', [], [])).toEqual([
      { id: 'studio-empty', label: '暂无 AI 产物', disabled: true },
    ]);
  });

  it('prefers the server-authorized resource status over the local descriptor', () => {
    const stale = source({
      status: 'ready',
      resource: { status: 'failed' } as AssetItem['resource'],
    });

    expect(itemsForRoute('source-browse', [stale], [])[0]?.secondary).toBe(
      '处理失败',
    );
  });

  it('reports an artifact without versions as generating rather than v0', () => {
    const pending = output({ latestVersion: 0 });

    expect(itemsForRoute('output-browse', [], [pending])[0]?.secondary).toBe(
      '生成中',
    );
  });
});
