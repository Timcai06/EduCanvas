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
const protocolRegistration = readFileSync(
  'src/main/desktop-protocol-registration.ts',
  'utf8',
);
const benchmark = readFileSync(
  '../../scripts/windows/measure-desktop-package.ps1',
  'utf8',
);
const installer = readFileSync('assets/installer.nsh', 'utf8');

describe('desktop package configuration', () => {
  it('builds both an x64 installer and a portable executable', () => {
    expect(builderConfig).toMatch(/- target: nsis/);
    expect(builderConfig).toMatch(/- target: portable/);
    expect(builderConfig).toMatch(/schemes:\s*\r?\n\s*- educanvas/);
    expect(protocolRegistration).toContain('app.setAsDefaultProtocolClient');
    expect(protocolRegistration).toContain(
      "process.env['PORTABLE_EXECUTABLE_FILE']",
    );
    expect(mainEntry).toContain('app.requestSingleInstanceLock()');
    expect(mainEntry).toContain("app.on('second-instance'");
    expect(mainEntry).toContain('findDesktopDeepLink(commandLine)');
    expect(builderConfig).toMatch(/nsis:\s*\r?\n/);
    expect(builderConfig).toMatch(/oneClick: false/);
    expect(builderConfig).toMatch(/allowToChangeInstallationDirectory: true/);
    expect(builderConfig).toMatch(/deleteAppDataOnUninstall: false/);
    expect(builderConfig).toContain('include: assets/installer.nsh');
    expect(installer).toContain(
      'DeleteRegKey HKCU "Software\\Classes\\educanvas"',
    );
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
    expect(desktopLane).toContain('windows-latest');
    expect(desktopLane).toContain('package:windows');
    expect(desktopLane).toContain('Get-AuthenticodeSignature');
    expect(desktopLane).toContain('actions/upload-artifact@');
    expect(desktopLane).toContain('apps/desktop/dist/*.exe');
  });

  it('builds macOS x64 and arm64 packages with microphone permission metadata', () => {
    expect(builderConfig).toContain('target: dmg');
    expect(builderConfig).toContain('target: zip');
    expect(builderConfig).toContain('NSMicrophoneUsageDescription');
    expect(builderConfig).toContain('entitlements.mac.plist');
    expect(packageJson.scripts?.['package:macos']).toContain(
      'electron-builder --mac',
    );
    expect(ci).toContain('macos-latest');
    expect(ci).toContain('package:macos');
    expect(ci).toContain('apps/desktop/dist/*.dmg');
  });

  it('keeps the Windows benchmark inside the package process tree', () => {
    expect(benchmark).toContain('apps\\desktop\\dist');
    expect(benchmark).toContain('ConvertTo-Json');
    expect(benchmark).toContain('Remember-RecordedProcessTree');
    expect(benchmark).toContain('$recordedProcesses.Values');
    expect(benchmark).toContain(
      '$liveRecord.CreationDate -ne $record.CreationDate',
    );
    expect(benchmark).toMatch(/Stop-Process -Id \$pidValue/);
    expect(benchmark).not.toMatch(/taskkill/i);
    expect(benchmark).not.toMatch(/Stop-Process[^\r\n]*-Name/i);
    expect(benchmark).not.toMatch(/Get-Process electron/i);
  });
});
