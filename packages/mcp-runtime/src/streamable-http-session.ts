import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createBoundedFetch } from './bounded-fetch';
import type {
  McpProtocolSession,
  McpProtocolSessionFactory,
} from './sdk-session';

class StreamableHttpMcpSession implements McpProtocolSession {
  private readonly client = new Client(
    { name: 'educanvas', version: '0.1.0' },
    { capabilities: {} },
  );
  private readonly transport: StreamableHTTPClientTransport;

  constructor(input: { endpoint: string; authorization?: string }) {
    this.transport = new StreamableHTTPClientTransport(
      new URL(input.endpoint),
      {
        fetch: createBoundedFetch(),
        requestInit: {
          redirect: 'error',
          ...(input.authorization
            ? { headers: { authorization: input.authorization } }
            : {}),
        },
      },
    );
  }

  async connect(input: { signal: AbortSignal; timeoutMs: number }) {
    await this.client.connect(this.transport, {
      signal: input.signal,
      timeout: input.timeoutMs,
      maxTotalTimeout: input.timeoutMs,
    });
  }

  async listTools(input: {
    cursor?: string;
    signal: AbortSignal;
    timeoutMs: number;
  }) {
    const result = await this.client.listTools(
      input.cursor ? { cursor: input.cursor } : undefined,
      {
        signal: input.signal,
        timeout: input.timeoutMs,
        maxTotalTimeout: input.timeoutMs,
      },
    );
    return {
      tools: result.tools.map((tool) => ({
        name: tool.name,
        inputSchema: tool.inputSchema,
      })),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };
  }

  async callTool(input: {
    name: string;
    arguments: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
    timeoutMs: number;
  }) {
    return this.client.callTool(
      { name: input.name, arguments: input.arguments },
      undefined,
      {
        signal: input.signal,
        timeout: input.timeoutMs,
        maxTotalTimeout: input.timeoutMs,
      },
    );
  }

  async close(): Promise<void> {
    if (this.transport.sessionId) {
      await this.transport.terminateSession().catch(() => undefined);
    }
    await this.client.close().catch(() => undefined);
  }
}

export class StreamableHttpMcpSessionFactory implements McpProtocolSessionFactory {
  open(input: {
    registration: { endpoint: string };
    authorization?: string;
  }): McpProtocolSession {
    return new StreamableHttpMcpSession({
      endpoint: input.registration.endpoint,
      ...(input.authorization ? { authorization: input.authorization } : {}),
    });
  }
}
