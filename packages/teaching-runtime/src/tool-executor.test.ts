import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  defineTeachingTool,
  TeachingToolExecutor,
  type TeachingToolHandlerContext,
  type ToolExecutionAuditRecord,
  type ToolExecutionRequest,
} from './tool-executor';

const context = (
  executionId: string,
  state: ToolExecutionRequest['context']['state'] = 'EXPLAIN',
): ToolExecutionRequest['context'] => ({
  traceId: 'trace-1',
  turnId: 'turn-1',
  executionId,
  studentId: 'student-1',
  sessionId: 'session-1',
  knowledgeNodeId: 'node-1',
  state,
  invoker: 'model',
});

type TestReadHandler = (
  input: Record<string, never>,
  context: TeachingToolHandlerContext,
) => unknown | Promise<unknown>;

const createReadTool = (
  handler: TestReadHandler = async () => ({ state: 'EXPLAIN' }),
) =>
  defineTeachingTool({
    name: 'getStudentState',
    description: '读取当前可信教学状态',
    exposure: 'model',
    effect: 'read',
    timeoutMs: 100,
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ state: z.literal('EXPLAIN') }).strict(),
    handler: async (input, handlerContext) =>
      (await handler(input, handlerContext)) as { state: 'EXPLAIN' },
  });

const createKnowledgeTool = (
  handler = vi.fn(async ({ query }: { query: string }) => ({ query })),
) =>
  defineTeachingTool({
    name: 'retrieveKnowledge',
    description: '读取知识证据',
    exposure: 'model',
    effect: 'read',
    timeoutMs: 100,
    inputSchema: z.object({ query: z.string().min(1).max(100) }).strict(),
    outputSchema: z.object({ query: z.string() }).strict(),
    handler,
  });

const request = (
  executionId: string,
  rawCall: unknown = { tool: 'getStudentState', arguments: {} },
  state: ToolExecutionRequest['context']['state'] = 'EXPLAIN',
): ToolExecutionRequest => ({ rawCall, context: context(executionId, state) });

describe('TeachingToolExecutor', () => {
  it('只向模型暴露当前状态允许、已注册且标记为model的工具', () => {
    const runtimeOnly = defineTeachingTool({
      name: 'renderCanvas',
      description: 'runtime内部Canvas工具',
      exposure: 'runtime',
      effect: 'write',
      timeoutMs: 100,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => ({ ok: true }),
    });
    const executor = new TeachingToolExecutor([createReadTool(), runtimeOnly]);

    expect(executor.listModelTools('EXPLAIN').map((tool) => tool.name)).toEqual(
      ['getStudentState'],
    );
    expect(executor.listModelTools('ASSESS').map((tool) => tool.name)).toEqual([
      'getStudentState',
    ]);
  });

  it('允许可信runtime调用runtime-only工具但不向模型暴露', async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const runtimeOnly = defineTeachingTool({
      name: 'renderCanvas',
      description: 'runtime内部Canvas工具',
      exposure: 'runtime',
      effect: 'write',
      timeoutMs: 100,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler,
    });
    const executor = new TeachingToolExecutor([runtimeOnly]);
    const runtimeContext = {
      ...context('exec-runtime'),
      invoker: 'runtime' as const,
    };

    const result = await executor.execute({
      rawCall: { tool: 'renderCanvas', arguments: {} },
      context: runtimeContext,
    });

    expect(result).toMatchObject({ ok: true, tool: 'renderCanvas' });
    expect(handler).toHaveBeenCalledOnce();
    expect(executor.listModelTools('EXPLAIN')).toEqual([]);
  });

  it.each([
    [{ tool: 'getStudentState' }, 'INVALID_CALL'],
    [
      { tool: 'getStudentState', arguments: {}, state: 'EXPLAIN' },
      'INVALID_CALL',
    ],
    [{ tool: 'deleteStudent', arguments: {} }, 'UNKNOWN_TOOL'],
    [{ tool: 'gradeAnswer', arguments: {} }, 'TOOL_NOT_ALLOWED'],
    [{ tool: 'renderCanvas', arguments: {} }, 'TOOL_NOT_AVAILABLE'],
    [
      { tool: 'getStudentState', arguments: { injected: true } },
      'INVALID_ARGUMENTS',
    ],
  ] as const)('拒绝不可信调用%o并返回稳定码%s', async (rawCall, code) => {
    const audits: ToolExecutionAuditRecord[] = [];
    const handler = vi.fn(async () => ({ state: 'EXPLAIN' as const }));
    const executor = new TeachingToolExecutor([createReadTool(handler)], {
      onAudit: (audit) => {
        audits.push(audit);
      },
    });

    const result = await executor.execute(request(`exec-${code}`, rawCall));

    expect(result).toMatchObject({ ok: false, code, replayed: false });
    expect(handler).not.toHaveBeenCalled();
    expect(audits).toHaveLength(1);
    expect(audits[0]).not.toHaveProperty('arguments');
    expect(audits[0]).not.toHaveProperty('output');
  });

  it('使用可信context调用handler并校验输出', async () => {
    const handler = vi.fn(
      async (
        _input: Record<string, never>,
        handlerContext: TeachingToolHandlerContext,
      ) => ({ state: handlerContext.state as 'EXPLAIN' }),
    );
    const executor = new TeachingToolExecutor([createReadTool(handler)]);

    const result = await executor.execute(request('exec-success'));

    expect(result).toMatchObject({
      ok: true,
      tool: 'getStudentState',
      output: { state: 'EXPLAIN' },
      replayed: false,
      audit: { status: 'succeeded', code: null },
    });
    expect(handler).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        studentId: 'student-1',
        state: 'EXPLAIN',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('输入Schema的transform只在预检阶段执行一次', async () => {
    const handler = vi.fn(async ({ query }: { query: string }) => ({ query }));
    const tool = defineTeachingTool({
      name: 'retrieveKnowledge',
      description: '读取知识证据',
      exposure: 'model',
      effect: 'read',
      timeoutMs: 100,
      inputSchema: z
        .object({ query: z.string().transform((value) => `${value}!`) })
        .strict(),
      outputSchema: z.object({ query: z.string() }).strict(),
      handler,
    });
    const executor = new TeachingToolExecutor([tool]);

    const result = await executor.execute(
      request('exec-transform', {
        tool: 'retrieveKnowledge',
        arguments: { query: '猫狗分类' },
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      output: { query: '猫狗分类!' },
    });
    expect(handler).toHaveBeenCalledWith(
      { query: '猫狗分类!' },
      expect.any(Object),
    );
  });

  it('将handler异常脱敏为HANDLER_ERROR', async () => {
    const audits: ToolExecutionAuditRecord[] = [];
    const tool = createReadTool(
      vi.fn(async () => {
        throw new Error('secret-token-and-stack');
      }),
    );
    const executor = new TeachingToolExecutor([tool], {
      onAudit: (audit) => {
        audits.push(audit);
      },
    });

    const result = await executor.execute(request('exec-error'));

    expect(result).toMatchObject({
      ok: false,
      code: 'HANDLER_ERROR',
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain('secret-token-and-stack');
    expect(JSON.stringify(audits)).not.toContain('secret-token-and-stack');
  });

  it('挂起的审计sink不会阻塞工具结果', async () => {
    const executor = new TeachingToolExecutor([createReadTool()], {
      onAudit: async () => new Promise<void>(() => {}),
    });

    await expect(
      executor.execute(request('exec-audit-hangs')),
    ).resolves.toMatchObject({ ok: true });
  });

  it('拒绝不符合输出Schema的适配器结果', async () => {
    const tool = createReadTool(vi.fn(async () => ({ state: 'ASSESS' })));
    const executor = new TeachingToolExecutor([tool]);

    const result = await executor.execute(request('exec-output'));

    expect(result).toMatchObject({ ok: false, code: 'INVALID_OUTPUT' });
  });

  it('超时后中止signal并仅将只读调用标记为可重试', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const tool = createReadTool(
      vi.fn(
        (
          _input: Record<string, never>,
          handlerContext: TeachingToolHandlerContext,
        ) =>
          new Promise<{ state: 'EXPLAIN' }>(() => {
            signal = handlerContext.signal;
          }),
      ),
    );
    const executor = new TeachingToolExecutor([tool]);

    const pending = executor.execute(request('exec-timeout'));
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;

    expect(result).toMatchObject({
      ok: false,
      code: 'TIMEOUT',
      retryable: true,
    });
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('写工具超时标记为结果未知且禁止自动重试', async () => {
    vi.useFakeTimers();
    const tool = defineTeachingTool({
      name: 'renderCanvas',
      description: '写入Canvas Artifact',
      exposure: 'runtime',
      effect: 'write',
      timeoutMs: 100,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: async () => new Promise<{ ok: boolean }>(() => {}),
    });
    const executor = new TeachingToolExecutor([tool]);

    const pending = executor.execute({
      rawCall: { tool: 'renderCanvas', arguments: {} },
      context: { ...context('exec-write-timeout'), invoker: 'runtime' },
    });
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      code: 'WRITE_TIMEOUT_OUTCOME_UNKNOWN',
      retryable: false,
      audit: { status: 'outcome_unknown' },
    });
    vi.useRealTimers();
  });

  it('同一executionId复用进行中或既有结果且不重复调用handler', async () => {
    const handler = vi.fn(async () => ({ state: 'EXPLAIN' as const }));
    const executor = new TeachingToolExecutor([createReadTool(handler)]);

    const [first, replay] = await Promise.all([
      executor.execute(request('exec-replay')),
      executor.execute(request('exec-replay')),
    ]);

    expect(first.replayed).toBe(false);
    expect(replay).toMatchObject({
      ok: true,
      replayed: true,
      audit: { status: 'replayed', durationMs: 0 },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('相同语义调用更换traceId时仍复用原执行结果', async () => {
    const handler = vi.fn(async () => ({ state: 'EXPLAIN' as const }));
    const executor = new TeachingToolExecutor([createReadTool(handler)]);
    await executor.execute(request('exec-new-trace'));

    const replay = await executor.execute({
      ...request('exec-new-trace'),
      context: { ...context('exec-new-trace'), traceId: 'trace-2' },
    });

    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('同一executionId绑定不同工具时拒绝冲突且不调用第二个handler', async () => {
    const stateHandler = vi.fn(async () => ({ state: 'EXPLAIN' as const }));
    const knowledgeHandler = vi.fn(async ({ query }: { query: string }) => ({
      query,
    }));
    const executor = new TeachingToolExecutor([
      createReadTool(stateHandler),
      createKnowledgeTool(knowledgeHandler),
    ]);

    await executor.execute(request('exec-conflict'));
    const conflict = await executor.execute(
      request('exec-conflict', {
        tool: 'retrieveKnowledge',
        arguments: { query: 'fractions' },
      }),
    );

    expect(conflict).toMatchObject({
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
      replayed: false,
    });
    expect(stateHandler).toHaveBeenCalledOnce();
    expect(knowledgeHandler).not.toHaveBeenCalled();
  });

  it('批次全部预检通过后按顺序执行', async () => {
    const order: string[] = [];
    const tool = createReadTool(
      vi.fn(
        async (
          _input: Record<string, never>,
          handlerContext: TeachingToolHandlerContext,
        ) => {
          order.push(handlerContext.executionId);
          return { state: 'EXPLAIN' as const };
        },
      ),
    );
    const executor = new TeachingToolExecutor([tool]);

    const result = await executor.executeBatch([
      request('exec-1'),
      request('exec-2'),
      request('exec-3'),
    ]);

    expect(result).toMatchObject({ accepted: true });
    expect(order).toEqual(['exec-1', 'exec-2', 'exec-3']);
  });

  it('批次存在任一预检拒绝时不执行任何handler', async () => {
    const handler = vi.fn(async () => ({ state: 'EXPLAIN' as const }));
    const executor = new TeachingToolExecutor([createReadTool(handler)]);

    const result = await executor.executeBatch([
      request('exec-valid'),
      request('exec-invalid', {
        tool: 'getStudentState',
        arguments: { unknown: true },
      }),
    ]);

    expect(result).toMatchObject({
      accepted: false,
      rejections: [expect.objectContaining({ code: 'INVALID_ARGUMENTS' })],
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('多调用批次包含写工具时整批拒绝且零执行', async () => {
    const readHandler = vi.fn(async () => ({ state: 'EXPLAIN' as const }));
    const writeHandler = vi.fn(async () => ({ ok: true }));
    const writeTool = defineTeachingTool({
      name: 'renderCanvas',
      description: '写入Canvas Artifact',
      exposure: 'runtime',
      effect: 'write',
      timeoutMs: 100,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      handler: writeHandler,
    });
    const executor = new TeachingToolExecutor([
      createReadTool(readHandler),
      writeTool,
    ]);

    const result = await executor.executeBatch([
      request('exec-read'),
      {
        rawCall: { tool: 'renderCanvas', arguments: {} },
        context: { ...context('exec-write'), invoker: 'runtime' },
      },
    ]);

    expect(result).toMatchObject({
      accepted: false,
      rejections: [
        expect.objectContaining({ code: 'WRITE_BATCH_NOT_SUPPORTED' }),
      ],
    });
    expect(readHandler).not.toHaveBeenCalled();
    expect(writeHandler).not.toHaveBeenCalled();
  });

  it('运行期失败后停止执行批次中的后续只读工具', async () => {
    const handler = vi
      .fn<TestReadHandler>()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValue({ state: 'EXPLAIN' });
    const executor = new TeachingToolExecutor([createReadTool(handler)]);

    const result = await executor.executeBatch([
      request('exec-fails'),
      request('exec-must-not-run'),
    ]);

    expect(result).toMatchObject({
      accepted: true,
      results: [expect.objectContaining({ code: 'HANDLER_ERROR' })],
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('批次内同一executionId绑定不同参数时零执行并拒绝冲突', async () => {
    const handler = vi.fn(async ({ query }: { query: string }) => ({ query }));
    const executor = new TeachingToolExecutor([createKnowledgeTool(handler)]);

    const result = await executor.executeBatch([
      request('exec-batch-conflict', {
        tool: 'retrieveKnowledge',
        arguments: { query: 'fractions' },
      }),
      request('exec-batch-conflict', {
        tool: 'retrieveKnowledge',
        arguments: { query: 'geometry' },
      }),
    ]);

    expect(result).toMatchObject({
      accepted: false,
      rejections: [
        expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
        expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
      ],
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('幂等缓存达到上限时淘汰已完成条目', async () => {
    const handler = vi.fn(async () => ({ state: 'EXPLAIN' as const }));
    const executor = new TeachingToolExecutor([createReadTool(handler)], {
      maxCachedExecutions: 1,
    });

    await executor.execute(request('exec-cache-1'));
    await executor.execute(request('exec-cache-2'));
    await executor.execute(request('exec-cache-1'));

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('拒绝重复注册和非法超时配置', () => {
    const tool = createReadTool();
    expect(() => new TeachingToolExecutor([tool, tool])).toThrow('重复注册');
    expect(() =>
      defineTeachingTool({
        name: 'getStudentState',
        description: 'invalid',
        exposure: 'model',
        effect: 'read',
        timeoutMs: 0,
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({}).strict(),
        handler: async () => ({}),
      }),
    ).toThrow('timeoutMs必须是正数');
    expect(
      () => new TeachingToolExecutor([tool], { maxCachedExecutions: 0 }),
    ).toThrow('maxCachedExecutions必须是正整数');
  });
});
