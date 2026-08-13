import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./general-workspace-header.tsx', import.meta.url)),
  'utf8',
);

describe('GeneralWorkspaceHeader navigation boundary', () => {
  it('removes the Studio action while preserving its layout slot', () => {
    expect(source).toContain('data-studio-placeholder');
    expect(source).not.toContain("id: 'studio'");
    expect(source).not.toContain("label: 'Studio'");
    expect(source).not.toContain('onOpenStudio');
  });
});
