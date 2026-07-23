import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const sdkAdapterFiles = new Set([
  'ai-sdk-protocol.ts',
  'ai-sdk-provider-factory.ts',
  'ai-sdk-turn-model-gateway.ts',
]);

const productionTypescriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTypescriptFiles(path);
    return entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.includes('.test')
      ? [path]
      : [];
  });

describe('model-gateway dependency boundary', () => {
  it('只依赖通用agent-core而不依赖K12教学包', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    const dependencies = Object.keys(packageJson.dependencies ?? {});

    expect(dependencies).toEqual([
      '@ai-sdk/openai-compatible',
      '@educanvas/agent-core',
      'ai',
      'zod',
    ]);
    expect(dependencies.some((name) => name.includes('teaching'))).toBe(false);
  });

  it('只允许可回滚AI SDK Adapter导入框架类型和实现', () => {
    const root = new URL('.', import.meta.url).pathname;
    const violations = productionTypescriptFiles(root)
      .filter((path) =>
        /from ['"](?:ai(?:\/[^'"]*)?|@ai-sdk\/[^'"]+)['"]/.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map((path) => relative(root, path))
      .filter((path) => !sdkAdapterFiles.has(path));

    expect(violations).toEqual([]);
  });
});
