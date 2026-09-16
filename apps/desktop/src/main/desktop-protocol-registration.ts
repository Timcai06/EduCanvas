import { resolve } from 'node:path';
import { app } from 'electron';

export function registerDesktopProtocolClient(protocol: string): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(protocol, process.execPath, [
      resolve(process.argv[1]),
    ]);
    return;
  }

  if (process.platform === 'win32') {
    // Portable builds run from a temporary directory, so keep the outer path.
    const executable =
      process.env['PORTABLE_EXECUTABLE_FILE'] ?? process.execPath;
    app.setAsDefaultProtocolClient(protocol, executable);
    return;
  }

  app.setAsDefaultProtocolClient(protocol);
}
