import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import runtimePackage from '../package.json';
import { describe, expect, it } from 'vitest';
import * as runtimePublicApi from './index';

const corePackage = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../teaching-core/package.json'),
    'utf8',
  ),
) as { dependencies?: Record<string, string> };

describe('Provider production boundary', () => {
  it('teaching-core与runtime不声明供应商或AI SDK运行时依赖', () => {
    const dependencies = [
      ...Object.keys(corePackage.dependencies ?? {}),
      ...Object.keys(runtimePackage.dependencies ?? {}),
    ];
    const forbiddenDependency =
      /^(?:ai|@ai-sdk\/|openai|@anthropic-ai\/|deepseek)/;

    expect(
      dependencies.filter((dependency) => forbiddenDependency.test(dependency)),
    ).toEqual([]);
  });

  it('生产包入口不导出ScriptedGateway', () => {
    expect('ScriptedModelGateway' in runtimePublicApi).toBe(false);
  });
});
