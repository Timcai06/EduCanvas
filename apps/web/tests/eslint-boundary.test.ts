import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * W05 静态边界门禁 negative fixtures。
 *
 * 用真实 eslint.config.mjs 对「features/** 路径的代码片段」lint，断言违规导入
 * 被 no-restricted-imports 拦截、合法导入（如 @/app/actions server actions）放行。
 */
const eslint = new ESLint({
  overrideConfigFile: 'eslint.config.mjs',
});

async function lintFeatureCode(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: 'apps/web/features/workspace/probe.ts',
  });
  if (!result) return [];
  return result.messages
    .map((message) => message.ruleId)
    .filter((ruleId): ruleId is string => ruleId !== null);
}

describe('W05 features 静态边界门禁', () => {
  it('features/** 导入 server 层被拦截', async () => {
    const ruleIds = await lintFeatureCode(
      'import { fetchGateway } from "@/server/gateway";',
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('features/** 导入 @educanvas/db 被拦截', async () => {
    const ruleIds = await lintFeatureCode(
      'import { db } from "@educanvas/db";',
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('features/** 导入 server-only 被拦截', async () => {
    const ruleIds = await lintFeatureCode('import "server-only";');
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('features/** 导入数据库 schema 被拦截', async () => {
    const ruleIds = await lintFeatureCode(
      'import { usersTable } from "@/db/schema";',
    );
    expect(ruleIds).toContain('no-restricted-imports');
  });

  it('features/** 导入 @/app/actions（合法 server actions）放行', async () => {
    const ruleIds = await lintFeatureCode(
      'import { startGeneralChatAction } from "@/app/actions";',
    );
    expect(ruleIds).not.toContain('no-restricted-imports');
  });

  it('features/** 跨 feature 直接导入（走公开文件）不触发 server 边界规则', async () => {
    const ruleIds = await lintFeatureCode(
      'import { CanvasHost } from "@/features/canvas/canvas-host";',
    );
    expect(ruleIds).not.toContain('no-restricted-imports');
  });
});
