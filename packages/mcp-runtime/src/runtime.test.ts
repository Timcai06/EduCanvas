import { describe, expect, it, vi } from 'vitest';
import type { McpClientPort } from './contracts';
import { createMcpRuntimeFromEnvironment } from './runtime';
import { mcpRegistration } from './test-support';

describe('MCP生产Runtime组合', () => {
  it('无配置与非法配置都有稳定disabled状态', () => {
    expect(createMcpRuntimeFromEnvironment({}).statuses()).toEqual([
      expect.objectContaining({
        serverId: 'mcp',
        status: 'disabled',
        failureCode: null,
      }),
    ]);
    expect(
      createMcpRuntimeFromEnvironment({
        EDUCANVAS_DEPLOYMENT_ENV: 'production',
        EDUCANVAS_MCP_TOOLS_JSON: JSON.stringify([mcpRegistration()]),
      }).statuses(),
    ).toEqual([
      expect.objectContaining({
        serverId: 'mcp.configuration',
        status: 'disabled',
        failureCode: 'configuration',
      }),
    ]);
  });

  it('缺Broker时不暴露Bearer工具，无鉴权工具进入统一Adapter', async () => {
    const bearer = createMcpRuntimeFromEnvironment({
      EDUCANVAS_DEPLOYMENT_ENV: 'local',
      EDUCANVAS_MCP_TOOLS_JSON: JSON.stringify([
        mcpRegistration({ authentication: 'bearer' }),
      ]),
    });
    expect(bearer.adapters).toEqual([]);
    expect(bearer.statuses()[0]).toMatchObject({
      status: 'disabled',
      failureCode: 'credential',
    });

    const client: McpClientPort = {
      callTool: vi.fn(async () => ({
        content: [{ type: 'text', text: 'bounded' }],
      })),
    };
    const runtime = createMcpRuntimeFromEnvironment(
      {
        EDUCANVAS_DEPLOYMENT_ENV: 'local',
        EDUCANVAS_MCP_TOOLS_JSON: JSON.stringify([mcpRegistration()]),
      },
      { client },
    );
    expect(runtime.capabilities).toEqual(['knowledge.lookup']);
    expect(runtime.adapters).toHaveLength(1);
    expect(runtime.adapters[0]).toMatchObject({
      name: 'studyLookup',
      source: 'mcp',
      risk: 'l0',
      effect: 'read',
      modelInputSchema: mcpRegistration().inputSchema,
    });
    await expect(
      runtime.adapters[0]!.invoke(
        { query: 'fractions' },
        {
          operationId: 'operation:1',
          executionId: 'execution:1',
          conversationId: 'conversation:1',
          traceId: 'trace:1',
          actorId: 'user:owner',
          agentId: 'agent:personal',
          notebookId: 'notebook:1',
          profileId: 'education.default',
          channel: 'web',
          environment: 'test',
          credentialHandle: null,
          profileContext: {},
          signal: new AbortController().signal,
        },
      ),
    ).resolves.toEqual({ untrusted: true, text: ['bounded'] });
  });
});
