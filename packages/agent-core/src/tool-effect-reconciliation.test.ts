import { describe, expect, it } from 'vitest';
import {
  toolEffectReconciliationResolutions,
  toolEffectReconciliationSources,
} from './tool-effect-reconciliation';

describe('Tool Effect reconciliation契约', () => {
  it('只公开追加式确认决议与可信来源', () => {
    expect(toolEffectReconciliationResolutions).toEqual([
      'confirmed_committed',
      'confirmed_not_committed',
    ]);
    expect(toolEffectReconciliationSources).toEqual(['manual', 'adapter']);
  });
});
