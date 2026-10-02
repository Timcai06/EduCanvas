import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  DEEP_RESEARCH_MAX_TOOL_ROUNDS,
  DeepResearchOutputGuard,
} from './general-deep-research';

const insufficientEvidenceMessage =
  '研究材料不足：本轮未达到三轮搜索、五个已读来源和五个有效引用的要求。请补充来源或缩小主题后发起新研究。';

describe('DeepResearchOutputGuard evidence gates', () => {
  it('holds generated text and emits no report when no research tools ran', async () => {
    const report = '# 摘要\n内部草稿，不应泄漏。[1][2][3][4][5]';
    const guard = new DeepResearchOutputGuard({
      successfulSearchCount: 0,
      sourceCount: 0,
    });

    await expect(guard.push(report)).resolves.toEqual({ kind: 'hold' });
    const result = await guard.finish();
    expect(result).toMatchObject({
      kind: 'block',
      failureCode: 'RESEARCH_REQUIREMENTS_UNMET',
      publicContent:
        '研究材料不足：本轮未达到三轮搜索、五个已读来源和五个有效引用的要求。请补充来源或缩小主题后发起新研究。',
    });
    expect(JSON.stringify(result)).not.toContain('内部草稿');
    expect(JSON.stringify(result)).not.toContain('[1][2][3][4][5]');
  });

  it.each([
    {
      label: 'search rounds',
      searches: 2,
      sources: 5,
      report: '[1][2][3][4][5]',
    },
    {
      label: 'read sources',
      searches: 3,
      sources: 4,
      report: '[1][2][3][4][5]',
    },
    {
      label: 'valid citation markers',
      searches: 3,
      sources: 5,
      report: '[1][2][3][4]',
    },
  ])('blocks when the $label threshold is unmet', async (scenario) => {
    const guard = new DeepResearchOutputGuard({
      successfulSearchCount: scenario.searches,
      sourceCount: scenario.sources,
    });
    await guard.push(`# 摘要\n${scenario.report}`);

    await expect(guard.finish()).resolves.toMatchObject({
      kind: 'block',
      failureCode: 'RESEARCH_REQUIREMENTS_UNMET',
      publicContent: insufficientEvidenceMessage,
    });
  });

  it('emits the held report when all three evidence thresholds are met', async () => {
    const report =
      '# 摘要\n结论一[1]，结论二[2]，结论三[3]，结论四[4]，结论五[5]。';
    const guard = new DeepResearchOutputGuard({
      successfulSearchCount: 3,
      sourceCount: 5,
    });

    await expect(guard.push(report)).resolves.toEqual({ kind: 'hold' });
    await expect(guard.finish()).resolves.toEqual({
      kind: 'emit',
      safeDeltas: [report],
    });
  });

  it('keeps the report length cap at 128,000 characters', async () => {
    expect(DEEP_RESEARCH_MAX_TOOL_ROUNDS).toBe(6);
    const valid = new DeepResearchOutputGuard({
      successfulSearchCount: 3,
      sourceCount: 5,
    });
    const atLimit = `${'x'.repeat(127_985)}[1][2][3][4][5]`;
    expect(atLimit).toHaveLength(128_000);
    await expect(valid.push(atLimit)).resolves.toEqual({ kind: 'hold' });
    await expect(valid.finish()).resolves.toMatchObject({ kind: 'emit' });

    const oversized = new DeepResearchOutputGuard({
      successfulSearchCount: 3,
      sourceCount: 5,
    });
    await expect(oversized.push(`${atLimit}x`)).resolves.toMatchObject({
      kind: 'block',
      failureCode: 'BUDGET_EXCEEDED',
    });
  });
});
