import { describe, expect, it } from 'vitest';
import type { AssetItem } from '@/features/assets/assets-drawer';
import { resolveSourcePreview } from './source-preview-selection';

function source(overrides: Partial<AssetItem> = {}): AssetItem {
  return {
    id: 'source-1',
    versionId: null,
    label: '讲义.pdf',
    kind: 'document',
    scope: 'space',
    status: 'processing',
    processing: null,
    enabled: false,
    selectable: false,
    resource: null,
    ...overrides,
  };
}

describe('resolveSourcePreview', () => {
  it('resolves the selected source from the latest polling snapshot', () => {
    const selectedId = source().id;
    const refreshed = source({
      versionId: 'version-1',
      status: 'ready',
      selectable: true,
    });

    expect(resolveSourcePreview([refreshed], selectedId)).toBe(refreshed);
  });

  it('closes the preview when the selected source is no longer present', () => {
    expect(resolveSourcePreview([], 'source-1')).toBeNull();
  });
});
