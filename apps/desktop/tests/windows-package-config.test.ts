import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const builderConfig = readFileSync('electron-builder.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const ci = readFileSync('../../.github/workflows/ci.yml', 'utf8');
const mainEntry = readFileSync('src/main/index.ts', 'utf8');
const benchmark = readFileSync(
  '../../scripts/windows/measure-desktop-package.ps1',
  'utf8',
);

describe('DP11 Windows package configuration', () => {
  it('builds both an x64 installer and a portable executable', () => {
    expect(builderConfig).toMatch(/- target: nsis/);
    expect(builderConfig).toMatch(/- target: portable/);
    expect(builderConfig).toMatch(/schemes:\s*\r?\n\s*- educanvas/);
    expect(mainEntry).toContain('app.setAsDefaultProtocolClient');
    expect(mainEntry).toContain('app.requestSingleInstanceLock()');
    expect(mainEntry).toContain("app.on('second-instance'");
    expect(mainEntry).toContain('findDesktopDeepLink(commandLine)');
    expect(builderConfig).toMatch(/nsis:\s*\r?\n/);
    expect(builderConfig).toMatch(/oneClick: false/);
    expect(builderConfig).toMatch(/allowToChangeInstallationDirectory: true/);
    expect(builderConfig).toMatch(/deleteAppDataOnUninstall: false/);
    expect(packageJson.scripts?.['package:windows']).toContain(
      'electron-builder --win',
    );
    expect(packageJson.dependencies).toMatchObject({
      '@educanvas/gateway-client': 'workspace:*',
      '@educanvas/gateway-core': 'workspace:*',
    });
    expect(builderConfig).toMatch(/- ["']!node_modules\/\*\*["']/);
    expect(packageJson.scripts?.['audit:windows-package']).toContain(
      'audit-windows-package.mjs',
    );
  });

  it('packages and audits the distributables on a Windows CI runner', () => {
    const desktopLane = ci.slice(
      ci.indexOf('  desktop-build:'),
      ci.indexOf('  runtime-pressure:'),
    );
    expect(desktopLane).toContain('runs-on: windows-latest');
    expect(desktopLane).toContain('package:windows');
    expect(desktopLane).toContain('Get-AuthenticodeSignature');
    expect(desktopLane).toContain('actions/upload-artifact@');
    expect(desktopLane).toContain('apps/desktop/dist/*.exe');
  });

  it('keeps the Windows benchmark inside the package process tree', () => {
    expect(benchmark).toContain('apps\\desktop\\dist');
    expect(benchmark).toContain('ConvertTo-Json');
    expect(benchmark).toMatch(/Stop-Process -Id \$pidValue/);
    expect(benchmark).not.toMatch(/taskkill/i);
    expect(benchmark).not.toMatch(/Stop-Process[^\r\n]*-Name/i);
    expect(benchmark).not.toMatch(/Get-Process electron/i);
  });
});
