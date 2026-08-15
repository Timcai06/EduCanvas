import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./general-workspace-header.tsx', import.meta.url)),
  'utf8',
);

describe('GeneralWorkspaceHeader navigation boundary', () => {
  it('exposes the dedicated resource console as a first-class page entry', () => {
    expect(source).toContain("id: 'resources'");
    expect(source).toContain("label: '资源控制台'");
    expect(source).toContain('onOpenStudio');
    expect(source).toContain('studioOpen');
    expect(source).not.toContain('data-studio-placeholder');
  });
});
