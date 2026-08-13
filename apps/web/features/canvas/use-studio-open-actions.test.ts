import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./use-studio-open-actions.ts', import.meta.url)),
  'utf8',
);

describe('Studio resource open authorization boundary', () => {
  it('checks fresh view authority before shell-rendered or registry paths', () => {
    const viewGate = source.indexOf("resource.allowedActions.includes('view')");
    const shellGate = source.indexOf(
      'isShellRenderedArtifactResource(resource)',
    );
    const registryGate = source.indexOf(
      'selectWebCanvasResourceRenderer(resource)',
    );
    expect(viewGate).toBeGreaterThan(0);
    expect(viewGate).toBeLessThan(shellGate);
    expect(viewGate).toBeLessThan(registryGate);
  });
});
