import { statSync } from 'node:fs';
import path from 'node:path';
import { listPackage } from '@electron/asar';

const desktopRoot = process.cwd();
const distRoot = path.resolve(desktopRoot, 'dist');
const archivePath = path.resolve(
  desktopRoot,
  process.argv[2] ?? 'dist/win-unpacked/resources/app.asar',
);
const relativeArchive = path.relative(distRoot, archivePath);
if (
  relativeArchive === '' ||
  relativeArchive.startsWith('..') ||
  path.isAbsolute(relativeArchive)
) {
  throw new Error('Windows package audit target must stay inside dist/.');
}

const entries = listPackage(archivePath, { isPack: false }).map((entry) =>
  entry.replaceAll('\\', '/').toLowerCase(),
);
const requiredEntries = [
  '/package.json',
  '/assets/icon.png',
  '/out/main/index.js',
  '/out/preload/index.js',
  '/out/renderer/index.html',
];
const missing = requiredEntries.filter((entry) => !entries.includes(entry));
if (missing.length > 0) {
  throw new Error(
    `Windows package is missing required entries: ${missing.join(', ')}`,
  );
}

const forbiddenSegment =
  /(^|\/)(?:node_modules|coverage|\.turbo|\.git|test-results|playwright-report)(?:\/|$)/;
const forbiddenFile =
  /(^|\/)(?:\.env(?:\.[^/]*)?|desktop-session\.enc|[^/]+\.(?:pem|key|p12|pfx))$/;
const forbidden = entries.filter(
  (entry) => forbiddenSegment.test(entry) || forbiddenFile.test(entry),
);
if (forbidden.length > 0) {
  throw new Error(
    `Windows package contains forbidden development or secret-bearing paths: ${forbidden.slice(0, 10).join(', ')}`,
  );
}

const unexpectedTopLevel = entries.filter((entry) => {
  const topLevel = entry.split('/').filter(Boolean)[0];
  return topLevel && !['assets', 'out', 'package.json'].includes(topLevel);
});
if (unexpectedTopLevel.length > 0) {
  throw new Error(
    `Windows package contains unexpected top-level paths: ${unexpectedTopLevel.slice(0, 10).join(', ')}`,
  );
}

process.stdout.write(
  `${JSON.stringify({
    schema: 'educanvas.desktop.windows-package-audit.v1',
    archive: path.basename(archivePath),
    archiveBytes: statSync(archivePath).size,
    entries: entries.length,
    forbiddenEntries: 0,
  })}\n`,
);
