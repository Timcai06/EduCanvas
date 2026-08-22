#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const markdownLinkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;

function normalizeTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  const target = trimmed.startsWith('<')
    ? trimmed.slice(1, trimmed.indexOf('>'))
    : trimmed.split(/\s+["']/u, 1)[0];
  return target.split('#', 1)[0];
}

export function localMarkdownTargets(source) {
  const prose = source
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]+`/g, '');
  return [...prose.matchAll(markdownLinkPattern)]
    .map((match) => normalizeTarget(match[1]))
    .filter(Boolean)
    .filter(
      (target) =>
        !target.startsWith('#') &&
        !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target),
    );
}

export function brokenMarkdownLinks(markdownFiles, root = repoRoot) {
  const violations = [];
  for (const relativePath of markdownFiles) {
    const absolutePath = path.resolve(root, relativePath);
    if (!existsSync(absolutePath)) continue;
    const source = readFileSync(absolutePath, 'utf8');
    for (const target of localMarkdownTargets(source)) {
      let decodedTarget;
      try {
        decodedTarget = decodeURIComponent(target);
      } catch {
        violations.push(`${relativePath}: invalid encoded link ${target}`);
        continue;
      }
      const resolved = path.resolve(path.dirname(absolutePath), decodedTarget);
      if (!existsSync(resolved)) {
        violations.push(`${relativePath}: missing ${target}`);
      }
    }
  }
  return violations;
}

export function workspaceMarkdownFiles(root = repoRoot) {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '*.md'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => existsSync(path.resolve(root, relativePath)))
    .sort();
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = workspaceMarkdownFiles();
  const violations = brokenMarkdownLinks(files);
  if (violations.length > 0) {
    process.stderr.write(
      `Broken repository Markdown links:\n${violations.map((item) => `- ${item}`).join('\n')}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`Validated ${files.length} Markdown files.\n`);
  }
}
