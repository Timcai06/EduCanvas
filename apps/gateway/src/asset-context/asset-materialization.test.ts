import { describe, expect, it } from 'vitest';
import {
  AssetVersionIntegrityError,
  requireReferencedStoredVersion,
} from './asset-materialization';

describe('gateway asset version integrity', () => {
  it('accepts only the exact stored asset version named by the reference', () => {
    const reference = { assetId: 'asset-1', versionId: 'version-1' };

    expect(() =>
      requireReferencedStoredVersion(reference, {
        assetId: 'asset-1',
        versionId: 'version-1',
      }),
    ).not.toThrow();
    expect(() =>
      requireReferencedStoredVersion(reference, {
        assetId: 'asset-1',
        versionId: 'version-2',
      }),
    ).toThrow(AssetVersionIntegrityError);
  });
});
