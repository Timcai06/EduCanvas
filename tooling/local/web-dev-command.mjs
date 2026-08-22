export function resolveWebDevCommand(platform = process.platform) {
  return {
    command: 'pnpm',
    args: [
      'exec',
      'next',
      'dev',
      // Next 16.2.10 Turbopack can crash while formatting Unicode-bearing
      // diagnostics on Windows. Keep the compatibility fallback scoped there.
      ...(platform === 'win32' ? ['--webpack'] : []),
    ],
    shell: platform === 'win32',
  };
}
