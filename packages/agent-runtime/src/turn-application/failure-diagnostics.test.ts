import { ContextEngineInputError } from '../context/context-engine';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { turnApplicationFailureLogLine } from './failure-diagnostics';

describe('Turn Application failure diagnostics', () => {
  it('预算分类只记录稳定原因，不记录正文或堆栈', () => {
    const line = turnApplicationFailureLogLine({
      operationId: 'operation:1',
      stage: 'prepare',
      error: new ContextEngineInputError(
        'secret-source-body',
        'required_budget_exceeded',
      ),
    });
    expect(JSON.parse(line).error).toMatchObject({
      code: 'invalid_context_engine_input',
      reason: 'required_budget_exceeded',
    });
    expect(line).not.toContain('secret-source-body');
    expect(line).not.toContain('stack');
  });

  it('只记录阶段与Zod字段路径，不记录被拒绝的值', () => {
    const rejectedValue = 'provider-secret-never-log';
    const parsed = z
      .object({ allowed: z.string() })
      .strict()
      .safeParse({ allowed: 'ok', persistedMetadata: rejectedValue });
    if (parsed.success) throw new Error('fixture_must_fail');

    const line = turnApplicationFailureLogLine({
      operationId: '00000000-0000-4000-8000-000000000001',
      stage: 'prepare',
      error: parsed.error,
      now: new Date('2026-08-24T00:00:00.000Z'),
    });

    expect(JSON.parse(line)).toMatchObject({
      event: 'turn.application.failed',
      operationId: '00000000-0000-4000-8000-000000000001',
      stage: 'prepare',
      error: {
        name: 'ZodError',
        code: 'unclassified',
        issues: [
          {
            code: 'unrecognized_keys',
            path: [],
            keys: ['persistedMetadata'],
          },
        ],
      },
    });
    expect(line).not.toContain(rejectedValue);
  });
});
