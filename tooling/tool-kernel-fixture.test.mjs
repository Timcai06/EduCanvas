import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defineFixtureTool,
  ToolKernelFixture,
} from './tool-kernel-fixture.mjs';

const sources = ['local', 'teaching', 'mcp', 'node'];

const context = (capability, overrides = {}) => ({
  executionId: 'execution:1',
  operationId: 'operation:1',
  actorId: 'user:1',
  agentId: 'agent:1',
  notebookId: 'notebook:1',
  capabilities: {
    actor: [capability],
    notebook: [capability],
    profile: [capability],
    channel: [capability],
    environment: [capability],
  },
  approvedCapabilities: [],
  ...overrides,
});

const tool = ({
  name = 'fixture.read',
  source = 'local',
  capability = 'fixture.read',
  effect = 'read',
  risk = 'l0',
  timeoutMs = 25,
  invoke = async () => ({ accepted: true }),
} = {}) =>
  defineFixtureTool({
    name,
    source,
    capability,
    effect,
    risk,
    timeoutMs,
    invoke,
  });

describe('Tool Kernel research fixture', () => {
  it('routes local, teaching, MCP and Node adapters through one kernel', async () => {
    const tools = sources.map((source) =>
      tool({
        name: `${source}.read`,
        source,
        capability: `${source}.read`,
        invoke: async (_arguments, trusted) => ({
          source,
          actorId: trusted.actorId,
        }),
      }),
    );
    const kernel = new ToolKernelFixture(tools);

    for (const source of sources) {
      const result = await kernel.execute({
        tool: `${source}.read`,
        arguments: {},
        context: context(`${source}.read`, {
          executionId: `execution:${source}`,
        }),
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.output, { source, actorId: 'user:1' });
    }

    assert.deepEqual(
      kernel.listLedger().map(({ source, status }) => [source, status]),
      sources.flatMap((source) => [
        [source, 'intended'],
        [source, 'committed'],
      ]),
    );
  });

  it('fails closed when any capability-intersection dimension denies', async () => {
    for (const deniedDimension of [
      'actor',
      'notebook',
      'profile',
      'channel',
      'environment',
    ]) {
      let invoked = false;
      const kernel = new ToolKernelFixture([
        tool({
          invoke: async () => {
            invoked = true;
          },
        }),
      ]);
      const trustedContext = context('fixture.read', {
        executionId: `execution:${deniedDimension}`,
      });
      trustedContext.capabilities[deniedDimension] = [];

      const result = await kernel.execute({
        tool: 'fixture.read',
        arguments: {},
        context: trustedContext,
      });

      assert.deepEqual(result, {
        ok: false,
        status: 'denied',
        code: `capability_denied:${deniedDimension}`,
        retryable: false,
        replayed: false,
      });
      assert.equal(invoked, false);
      assert.deepEqual(kernel.listLedger(), []);
    }
  });

  it('requires an approval before invoking an L2 write adapter', async () => {
    let invocations = 0;
    const capability = 'mcp.publish';
    const kernel = new ToolKernelFixture([
      tool({
        name: capability,
        source: 'mcp',
        capability,
        effect: 'write',
        risk: 'l2',
        invoke: async () => {
          invocations += 1;
          return { published: true };
        },
      }),
    ]);

    const pending = await kernel.execute({
      tool: capability,
      arguments: {},
      context: context(capability),
    });
    assert.equal(pending.status, 'approval_required');
    assert.equal(invocations, 0);
    assert.deepEqual(kernel.listLedger(), []);

    const approved = await kernel.execute({
      tool: capability,
      arguments: {},
      context: context(capability, {
        executionId: 'execution:approved',
        approvedCapabilities: [capability],
      }),
    });
    assert.equal(approved.ok, true);
    assert.equal(invocations, 1);
    assert.deepEqual(
      kernel.listLedger().map(({ status }) => status),
      ['intended', 'committed'],
    );
  });

  it('replays the same executionId without invoking the adapter twice', async () => {
    let invocations = 0;
    const kernel = new ToolKernelFixture([
      tool({
        invoke: async () => ({ sequence: ++invocations }),
      }),
    ]);
    const request = {
      tool: 'fixture.read',
      arguments: { b: 2, a: 1 },
      context: context('fixture.read'),
    };

    const first = await kernel.execute(request);
    const replay = await kernel.execute({
      ...request,
      arguments: { a: 1, b: 2 },
    });

    assert.equal(first.ok, true);
    assert.equal(replay.ok, true);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.output, { sequence: 1 });
    assert.equal(invocations, 1);
    assert.equal(kernel.listLedger().length, 2);
  });

  it('makes read timeout retryable and aborts the adapter signal', async () => {
    let aborted = false;
    const kernel = new ToolKernelFixture([
      tool({
        timeoutMs: 5,
        invoke: async (_arguments, trusted) =>
          new Promise((resolve) => {
            trusted.signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                resolve({ late: true });
              },
              { once: true },
            );
          }),
      }),
    ]);

    const result = await kernel.execute({
      tool: 'fixture.read',
      arguments: {},
      context: context('fixture.read'),
    });

    assert.deepEqual(result, {
      ok: false,
      status: 'timed_out',
      code: 'tool_timeout',
      retryable: true,
      replayed: false,
    });
    assert.equal(aborted, true);
    assert.equal(kernel.listLedger().at(-1).status, 'timed_out');
  });

  it('marks a write timeout outcome_unknown and never auto-retryable', async () => {
    const capability = 'node.write';
    const kernel = new ToolKernelFixture([
      tool({
        name: capability,
        source: 'node',
        capability,
        effect: 'write',
        risk: 'l2',
        timeoutMs: 5,
        invoke: async () => new Promise(() => undefined),
      }),
    ]);

    const result = await kernel.execute({
      tool: capability,
      arguments: {},
      context: context(capability, {
        approvedCapabilities: [capability],
      }),
    });

    assert.deepEqual(result, {
      ok: false,
      status: 'outcome_unknown',
      code: 'write_outcome_unknown',
      retryable: false,
      replayed: false,
    });
    assert.equal(kernel.listLedger().at(-1).status, 'outcome_unknown');
  });

  it('distinguishes read cancellation from unknown write outcome', async () => {
    const readAbort = new AbortController();
    const writeAbort = new AbortController();
    const never = async () => new Promise(() => undefined);
    const kernel = new ToolKernelFixture([
      tool({ name: 'local.wait', capability: 'local.wait', invoke: never }),
      tool({
        name: 'node.wait',
        source: 'node',
        capability: 'node.wait',
        effect: 'write',
        risk: 'l2',
        invoke: never,
      }),
    ]);

    const read = kernel.execute({
      tool: 'local.wait',
      arguments: {},
      context: context('local.wait', { executionId: 'execution:read-cancel' }),
      signal: readAbort.signal,
    });
    const write = kernel.execute({
      tool: 'node.wait',
      arguments: {},
      context: context('node.wait', {
        executionId: 'execution:write-cancel',
        approvedCapabilities: ['node.wait'],
      }),
      signal: writeAbort.signal,
    });
    readAbort.abort();
    writeAbort.abort();

    assert.equal((await read).status, 'cancelled');
    assert.equal((await write).status, 'outcome_unknown');
  });

  it('does not leak adapter errors, arguments or output into failures and ledger', async () => {
    const secret = 'student-secret-answer';
    const kernel = new ToolKernelFixture([
      tool({
        invoke: async () => {
          throw new Error(secret);
        },
      }),
    ]);

    const result = await kernel.execute({
      tool: 'fixture.read',
      arguments: { secret },
      context: context('fixture.read'),
    });
    const serialized = JSON.stringify({ result, ledger: kernel.listLedger() });

    assert.equal(result.code, 'tool_failed');
    assert.equal(serialized.includes(secret), false);
  });
});
