import { once } from 'node:events';
import type { Server } from 'node:http';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LifecycleMcpClient } from './client-lifecycle';
import { DenyMcpCredentialBroker } from './credential-broker';
import { McpStatusRegistry } from './status-registry';
import { mcpRegistration } from './test-support';

type TransportRequest = Parameters<
  StreamableHTTPServerTransport['handleRequest']
>[0] & { body: unknown };
type TransportResponse = Parameters<
  StreamableHTTPServerTransport['handleRequest']
>[1];

let httpServer: Server | null = null;

afterEach(async () => {
  if (!httpServer) return;
  httpServer.close();
  await once(httpServer, 'close');
  httpServer = null;
});

function createServer(): McpServer {
  const server = new McpServer({ name: 'educanvas-test', version: '1.0.0' });
  server.registerTool(
    'lookup',
    {
      description: 'lookup',
      inputSchema: { query: z.string().max(20) },
    },
    async ({ query }) => ({
      content: [{ type: 'text', text: `found:${query}` }],
      structuredContent: { query },
    }),
  );
  return server;
}

describe('官方MCP SDK Streamable HTTP实跑', () => {
  it('完成initialize、listTools、Schema核对、callTool和关闭', async () => {
    const app = createMcpExpressApp();
    app.post(
      '/mcp',
      async (request: TransportRequest, response: TransportResponse) => {
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await server.connect(transport);
        await transport.handleRequest(request, response, request.body);
        response.on('close', () => {
          void transport.close();
          void server.close();
        });
      },
    );
    const listener = app.listen(0, '127.0.0.1');
    httpServer = listener;
    await once(listener, 'listening');
    const address = listener.address();
    if (!address || typeof address === 'string')
      throw new Error('port_missing');
    const inputSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { query: { type: 'string', maxLength: 20 } },
      required: ['query'],
    } as const;
    const statuses = new McpStatusRegistry();
    const registration = mcpRegistration({
      endpoint: `http://127.0.0.1:${address.port}/mcp`,
      inputSchema,
    });
    const client = new LifecycleMcpClient(
      new DenyMcpCredentialBroker(),
      statuses,
    );

    await expect(
      client.callTool({
        registration,
        arguments: { query: 'fractions' },
        scope: {
          actorId: 'user:owner',
          agentId: 'agent:personal',
          credentialHandle: null,
          signal: new AbortController().signal,
        },
      }),
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: 'found:fractions' }],
      structuredContent: { query: 'fractions' },
    });
    expect(statuses.list()[0]).toMatchObject({
      status: 'ready',
      failureCode: null,
    });
  });
});
