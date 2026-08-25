import { describe, expect, it, vi } from 'vitest';

import { ensureElectronRuntime } from '../scripts/ensure-electron.mjs';

describe('ensureElectronRuntime', () => {
  it('accepts an installed Electron executable', () => {
    const pathExists = vi.fn(() => true);
    const repairElectron = vi.fn(() => true);

    expect(
      ensureElectronRuntime({
        resolveElectron: () => '/runtime/Electron',
        pathExists,
        repairElectron,
      }),
    ).toBe('/runtime/Electron');
    expect(pathExists).toHaveBeenCalledWith('/runtime/Electron');
    expect(repairElectron).not.toHaveBeenCalled();
  });

  it('repairs an Electron installation that initially fails to resolve', () => {
    const resolveElectron = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw new Error('download interrupted');
      })
      .mockReturnValue('/runtime/Electron');
    const repairElectron = vi.fn(() => true);

    expect(
      ensureElectronRuntime({
        resolveElectron,
        pathExists: () => true,
        repairElectron,
      }),
    ).toBe('/runtime/Electron');
    expect(repairElectron).toHaveBeenCalledOnce();
    expect(resolveElectron).toHaveBeenCalledTimes(2);
  });

  it('repairs an Electron executable that is initially absent on disk', () => {
    const pathExists = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const repairElectron = vi.fn(() => true);

    expect(
      ensureElectronRuntime({
        resolveElectron: () => '/runtime/Electron',
        pathExists,
        repairElectron,
      }),
    ).toBe('/runtime/Electron');
    expect(repairElectron).toHaveBeenCalledOnce();
  });

  it('reports the manual recovery command when automatic repair fails', () => {
    expect(() =>
      ensureElectronRuntime({
        resolveElectron: () => {
          throw new Error('download interrupted');
        },
        repairElectron: () => false,
      }),
    ).toThrow(/pnpm rebuild electron/);
  });

  it('rejects a runtime that remains absent after a successful repair command', () => {
    expect(() =>
      ensureElectronRuntime({
        resolveElectron: () => '/runtime/Electron',
        pathExists: () => false,
        repairElectron: () => true,
      }),
    ).toThrow(/still unavailable after repair/);
  });
});
