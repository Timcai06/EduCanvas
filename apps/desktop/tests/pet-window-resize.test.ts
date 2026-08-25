import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const windowSource = readFileSync('src/main/pet-window.ts', 'utf8');
const styles = readFileSync('src/renderer/src/styles.css', 'utf8');

describe('desktop pet bounded resizing', () => {
  it('enables native resizing with explicit minimum and maximum bounds', () => {
    expect(windowSource).toContain('resizable: true');
    expect(windowSource).toContain('minWidth: MVP_WINDOW_MIN_WIDTH');
    expect(windowSource).toContain('maxWidth: MVP_WINDOW_MAX_WIDTH');
    expect(windowSource).toContain("win.on('resize', schedulePositionSave)");
    expect(windowSource).toContain('savePetPositionFile(positionFile');
  });

  it('lets the original chat surface consume the resized window', () => {
    expect(styles).toContain('grid-template-columns: minmax(300px, 1fr) 176px');
    expect(styles).toContain('height: 100%');
  });
});
