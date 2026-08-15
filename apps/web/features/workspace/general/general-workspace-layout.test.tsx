import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./general-workspace-layout.tsx', import.meta.url)),
  'utf8',
);

describe('GeneralWorkspaceLayout page boundary', () => {
  it('switches directly between the conversation and Studio main pages', () => {
    expect(source).toContain('data-workspace-page="conversation"');
    expect(source).toContain('<StudioWorkspace');
    expect(source).toContain("surface.type === 'studio' ? (");
    expect(source).not.toContain('<PixelSwap');
    expect(source).not.toContain('<WorkspacePageTransition');
    expect(source).not.toContain('StudioOverlay');
  });

  it('keeps the compact resource Dock inside the conversation page', () => {
    expect(source.match(/<ResourceDock/g)).toHaveLength(1);
    expect(source.indexOf('<ResourceDock')).toBeGreaterThan(
      source.indexOf('data-workspace-page="conversation"'),
    );
    expect(source).toContain('onOpenLibrary={ctrl.openStudio}');
  });
});
