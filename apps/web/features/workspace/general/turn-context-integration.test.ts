import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  );
}

describe('Turn context integration boundary', () => {
  it('普通 Turn 仅消费统一 snapshot parts，不再按 kind 二次过滤', () => {
    const controller = source('./use-general-workspace-controller.ts');
    expect(controller).toMatch(
      /buildTurnContextSnapshot\(\s*frozenAssets \?\? assetsRef\.current/,
    );
    expect(controller).toContain('snapshot.parts.map');
    expect(controller).not.toMatch(/asset\.kind === ['"]image['"]/);
    expect(controller).not.toMatch(/asset\.kind === ['"]document['"]/);
  });

  it('Live ASR final 使用同一 builder 且 ref 在 render 时同步', () => {
    const context = source('../../voice/live-voice-context.ts');
    const composer = source('../../voice/voice-composer.tsx');
    expect(context).toContain('buildTurnContextSnapshot(assets)');
    expect(composer).toContain('useLayoutEffect(() =>');
    expect(composer).toContain('liveAssetsRef.current = liveAssets');
  });
});
