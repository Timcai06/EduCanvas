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

  it('高风险工具缺耐久依赖时禁用，依赖齐全时只暴露审批准备入口', async () => {
    const environment = {
      EDUCANVAS_DEPLOYMENT_ENV: 'local',
      EDUCANVAS_MCP_TOOLS_JSON: JSON.stringify([
        mcpRegistration({
          capability: 'external.mcp.invoke',
          risk: 'l2',
          effect: 'write',
        }),
      ]),
    };
    const disabled = createMcpRuntimeFromEnvironment(environment);
    expect(disabled.adapters).toEqual([]);
    expect(disabled.statuses()).toContainEqual(
      expect.objectContaining({
        serverId: 'study-tools.durability',
        status: 'disabled',
        failureCode: 'durability',
      }),
    );
    const highRiskClient = { callTool: vi.fn() };
    const enabled = createMcpRuntimeFromEnvironment(environment, {
      durableIntents: {
        prepare: vi.fn() as never,
        getForResume: vi.fn() as never,
        markDispatching: vi.fn() as never,
        settle: vi.fn() as never,
      },
      approvalIntents: { prepare: vi.fn() as never },
      intentCipher: {
        semanticsHash: vi.fn() as never,
        seal: vi.fn() as never,
        open: vi.fn() as never,
      },
      client: highRiskClient,
    });
    expect(enabled.adapters).toHaveLength(1);
    expect(enabled.adapters[0]).toMatchObject({
      risk: 'l2',
      effect: 'write',
      prepareApproval: expect.any(Function),
    });
    await expect(
      enabled.adapters[0]!.invoke(
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
    ).rejects.toThrow('mcp_durability');
    expect(highRiskClient.callTool).not.toHaveBeenCalled();
  });
});
