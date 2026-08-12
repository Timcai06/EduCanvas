import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./asset-client', () => ({
  uploadAsset: vi.fn(),
  importLinkAsset: vi.fn(),
}));

import { importLinkAsset, uploadAsset } from './asset-client';
import { importWorkspaceLink, uploadWorkspaceSource } from './source-intake';

describe('workspace source intake', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards one file request with the caller scope', async () => {
    vi.mocked(uploadAsset).mockResolvedValue({ id: 'asset-1' } as never);
    const file = new File(['x'], 'x.txt', { type: 'text/plain' });
    await uploadWorkspaceSource({ file, scope: 'space', endpoint: '/assets' });
    expect(uploadAsset).toHaveBeenCalledOnce();
    expect(uploadAsset).toHaveBeenCalledWith({
      file,
      scope: 'space',
      endpoint: '/assets',
    });
  });

  it('normalizes one link import request', async () => {
    vi.mocked(importLinkAsset).mockResolvedValue({ id: 'asset-1' } as never);
    await importWorkspaceLink(' https://example.com/source ');
    expect(importLinkAsset).toHaveBeenCalledWith({
      url: 'https://example.com/source',
    });
  });
});
