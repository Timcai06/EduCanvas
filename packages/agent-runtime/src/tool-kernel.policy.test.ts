import { describe, expect, it } from 'vitest';
import { ToolKernel } from './tool-kernel';
import {
  adapter,
  context,
  MemoryCallLedger,
  MemoryEffectLedger,
} from './tool-kernel.test-support';

describe('Tool Kernel策略与Adapter边界', () => {
  it('模型可见Schema可由可信Adapter投影且不替代本地执行校验', async () => {
    const modelInputSchema = {
      type: 'object',
      properties: { query: { type: 'string', maxLength: 20 } },
      required: ['query'],
      additionalProperties: false,
    } as const;
    const kernel = new ToolKernel(
      [adapter({ modelInputSchema })],
      new MemoryCallLedger(),
      new MemoryEffectLedger(),
    );

    expect(
      kernel.listDefinitions({
        capabilities: {
          actor: ['tool.execute'],
          notebook: ['tool.execute'],
          profile: ['tool.execute'],
          channel: ['tool.execute'],
          environment: ['tool.execute'],
        },
        approvedCapabilities: [],
      }),
    ).toEqual([expect.objectContaining({ inputSchema: modelInputSchema })]);
    await expect(
      kernel.execute({
        tool: 'runLocal',
        arguments: { query: 'remote-only' },
        context: context('local-validation'),
      }),
    ).resolves.toMatchObject({
      status: 'denied',
      code: 'invalid_arguments',
    });
  });

  it('四类Adapter共享同一权限、Schema和执行内核', async () => {
    const calls = new MemoryCallLedger();
    const effects = new MemoryEffectLedger();
    const sources = ['local', 'teaching', 'mcp', 'node'] as const;
    const kernel = new ToolKernel(
      sources.map((source) => adapter({ source })),
      calls,
      effects,
    );
    for (const source of sources) {
      await expect(
        kernel.execute({
          tool: adapter({ source }).name,
          arguments: { value: 'ok' },
          context: context(source),
        }),
      ).resolves.toMatchObject({ ok: true, output: { source } });
    }
    expect(calls.calls.size).toBe(4);
    expect(effects.effects.size).toBe(0);
  });

  it('只有write Adapter可绑定稳定对账核验器ID', () => {
    const create = (
      effect: 'read' | 'write',
      reconciliationVerifierId: string,
    ) =>
      new ToolKernel(
        [adapter({ effect, reconciliationVerifierId })],
        new MemoryCallLedger(),
        new MemoryEffectLedger(),
      );

    expect(() => create('write', 'adapter:effect-query-v1')).not.toThrow();
    expect(() => create('read', 'adapter:effect-query-v1')).toThrow(
      '非法或重复Tool Adapter',
    );
    expect(() => create('write', 'bad verifier id')).toThrow(
      '非法或重复Tool Adapter',
    );
  });
});
