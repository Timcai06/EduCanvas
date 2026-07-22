import { describe, expect, it, vi } from 'vitest';
import type { McpCredentialBrokerPort } from './contracts';
import { LifecycleMcpClient } from './client-lifecycle';
import { McpInvocationError } from './errors';
import type {
  McpListedTool,
  McpProtocolSession,
  McpProtocolSessionFactory,
} from './sdk-session';
import { McpStatusRegistry } from './status-registry';
import { mcpRegistration, TEST_INPUT_SCHEMA } from './test-support';

function sessionFactory(input: { tools?: readonly McpListedTool[] }) {
  const session: McpProtocolSession = {
    connect: vi.fn(async () => undefined),
    listTools: vi.fn(async () => ({
      tools: input.tools ?? [
        { name: 'lookup', inputSchema: TEST_INPUT_SCHEMA },
      ],
    })),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
    close: vi.fn(async () => undefined),
  };
  const open = vi.fn(() => session);
  return {
    factory: { open } satisfies McpProtocolSessionFactory,
    open,
    session,
  };
}

describe('MCP短生命周期客户端', () => {
  it('Credential仅进入传输工厂并在调用后可靠关闭', async () => {
    const statuses = new McpStatusRegistry(
      () => new Date('2026-07-22T00:00:00.000Z'),
    );
    const credential: McpCredentialBrokerPort = {
      resolveAuthorization: vi.fn(async () => ({
        authorization: 'Bearer private-token',
      })),
    };
    const fake = sessionFactory({});
    const client = new LifecycleMcpClient(credential, statuses, fake.factory);
    await expect(
      client.callTool({
        registration: mcpRegistration({ authentication: 'bearer' }),
        arguments: { query: 'fractions' },
        scope: {
          actorId: 'user:owner',
          agentId: 'agent:personal',
          credentialHandle: 'credential:opaque',
          signal: new AbortController().signal,
        },
      }),
    ).resolves.toMatchObject({ content: [{ text: 'ok' }] });
    expect(fake.open).toHaveBeenCalledWith(
      expect.objectContaining({ authorization: 'Bearer private-token' }),
    );
    expect(fake.session.close).toHaveBeenCalledOnce();
    expect(statuses.list()).toEqual([
      expect.objectContaining({
        serverId: 'study-tools',
        status: 'ready',
        failureCode: null,
      }),
    ]);
    expect(JSON.stringify(statuses.list())).not.toContain('private-token');
  });

  it('缺Credential和远端Schema漂移均fail closed且不执行工具', async () => {
    const statuses = new McpStatusRegistry();
    const credential: McpCredentialBrokerPort = {
      resolveAuthorization: vi.fn(async () => null),
    };
    const fake = sessionFactory({
      tools: [
        {
          name: 'lookup',
          inputSchema: { type: 'object', additionalProperties: true },
        },
      ],
    });
    const client = new LifecycleMcpClient(credential, statuses, fake.factory);
    await expect(
      client.callTool({
        registration: mcpRegistration({ authentication: 'bearer' }),
        arguments: { query: 'x' },
        scope: {
          actorId: 'user:owner',
          agentId: 'agent:personal',
          credentialHandle: null,
          signal: new AbortController().signal,
        },
      }),
    ).rejects.toMatchObject({ failureCode: 'credential' });
    await expect(
      client.callTool({
        registration: mcpRegistration(),
        arguments: { query: 'x' },
        scope: {
          actorId: 'user:owner',
          agentId: 'agent:personal',
          credentialHandle: null,
          signal: new AbortController().signal,
        },
      }),
    ).rejects.toBeInstanceOf(McpInvocationError);
    expect(fake.session.callTool).not.toHaveBeenCalled();
    expect(statuses.list()[0]).toMatchObject({
      status: 'degraded',
      failureCode: 'protocol',
    });
  });

  it('拒绝重复工具名和无界分页游标', async () => {
    const statuses = new McpStatusRegistry();
    const session: McpProtocolSession = {
      connect: vi.fn(async () => undefined),
      listTools: vi.fn(async () => ({
        tools: [
          { name: 'lookup', inputSchema: TEST_INPUT_SCHEMA },
          { name: 'lookup', inputSchema: TEST_INPUT_SCHEMA },
        ],
        nextCursor: 'repeat',
      })),
      callTool: vi.fn(async () => ({ content: [] })),
      close: vi.fn(async () => undefined),
    };
    const client = new LifecycleMcpClient(
      { resolveAuthorization: vi.fn(async () => null) },
      statuses,
      { open: () => session },
    );
    await expect(
      client.callTool({
        registration: mcpRegistration(),
        arguments: { query: 'x' },
        scope: {
          actorId: 'user:owner',
          agentId: 'agent:personal',
          credentialHandle: null,
          signal: new AbortController().signal,
        },
      }),
    ).rejects.toMatchObject({ failureCode: 'protocol' });
    expect(session.callTool).not.toHaveBeenCalled();
  });
});
