import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentToolRegistry, type AgentTool } from './agent-tools';

const context = {
  traceId: 't',
  turnId: 'turn',
  subjectId: 'subject',
  conversationId: 'conversation',
};

const echoTool: AgentTool<{ text: string }, { echoed: string }> = {
  name: 'echoText',
  description: '回显',
  inputSchema: z.object({ text: z.string().min(1) }).strict(),
  outputSchema: z.object({ echoed: z.string() }).strict(),
  timeoutMs: 100,
  handler: async (input) => ({ echoed: input.text }),
};

describe('AgentToolRegistry', () => {
  it('定义稳定排序,执行经入参出参双向校验', async () => {
    const registry = new AgentToolRegistry([echoTool]);
    expect(registry.listDefinitions()[0]).toMatchObject({ name: 'echoText' });

    const success = await registry.execute(
      { tool: 'echoText', arguments: { text: '你好' } },
      context,
    );
    expect(success).toMatchObject({ ok: true, output: { echoed: '你好' } });

    const badInput = await registry.execute(
      { tool: 'echoText', arguments: { text: 1 } },
      context,
    );
    expect(badInput).toMatchObject({ ok: false, code: 'TOOL_INPUT_INVALID' });

    const unknown = await registry.execute(
      { tool: 'missing', arguments: {} },
      context,
    );
    expect(unknown).toMatchObject({ ok: false, code: 'TOOL_NOT_AVAILABLE' });
  });

  it('超时与坏输出有稳定失败码,异常不外泄', async () => {
    const registry = new AgentToolRegistry([
      {
        ...echoTool,
        name: 'slowTool',
        handler: () => new Promise(() => undefined),
      },
      {
        ...echoTool,
        name: 'badOutput',
        handler: vi.fn(async () => ({ wrong: true }) as never),
      },
      {
        ...echoTool,
        name: 'boom',
        handler: vi.fn(async () => {
          throw new Error('secret-internal-detail');
        }),
      },
    ]);

    await expect(
      registry.execute({ tool: 'slowTool', arguments: { text: 'x' } }, context),
    ).resolves.toMatchObject({ ok: false, code: 'TOOL_TIMEOUT' });
    await expect(
      registry.execute(
        { tool: 'badOutput', arguments: { text: 'x' } },
        context,
      ),
    ).resolves.toMatchObject({ ok: false, code: 'TOOL_OUTPUT_INVALID' });
    const failed = await registry.execute(
      { tool: 'boom', arguments: { text: 'x' } },
      context,
    );
    expect(failed).toMatchObject({ ok: false, code: 'TOOL_FAILED' });
    expect(JSON.stringify(failed)).not.toContain('secret-internal-detail');
  });

  it('拒绝非法与重复工具名', () => {
    expect(() => new AgentToolRegistry([{ ...echoTool, name: 'Bad-Name' }]))
      .toThrow();
    expect(() => new AgentToolRegistry([echoTool, echoTool])).toThrow();
  });
});
