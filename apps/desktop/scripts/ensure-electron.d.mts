export interface ElectronRuntimeDependencies {
  resolveElectron?: () => unknown;
  pathExists?: (path: string) => boolean;
  repairElectron?: () => boolean;
}

export function ensureElectronRuntime(
  dependencies?: ElectronRuntimeDependencies,
): string;
