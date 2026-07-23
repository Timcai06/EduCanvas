import { describe, expect, it } from 'vitest';
import { readMcpToolRegistrations } from './configuration';
import { McpConfigurationError } from './errors';
import { mcpRegistration } from './test-support';

describe('MCP服务端可信注册', () => {
  it('无配置时诚实返回空能力', () => {
    expect(readMcpToolRegistrations({})).toEqual([]);
  });

  it('本地只允许loopback HTTP且生产强制HTTPS', () => {
    const local = JSON.stringify([mcpRegistration()]);
    expect(
      readMcpToolRegistrations({
        EDUCANVAS_DEPLOYMENT_ENV: 'local',
        EDUCANVAS_MCP_TOOLS_JSON: local,
      }),
    ).toHaveLength(1);
    expect(() =>
      readMcpToolRegistrations({
        EDUCANVAS_DEPLOYMENT_ENV: 'production',
        EDUCANVAS_MCP_TOOLS_JSON: local,
      }),
    ).toThrow(McpConfigurationError);
    expect(() =>
      readMcpToolRegistrations({
        EDUCANVAS_DEPLOYMENT_ENV: 'local',
        EDUCANVAS_MCP_TOOLS_JSON: JSON.stringify([
          mcpRegistration({ endpoint: 'http://example.com/mcp' }),
        ]),
      }),
    ).toThrow(McpConfigurationError);
  });

  it('拒绝重复模型名、同服务混合鉴权和无界Schema', () => {
    const cases = [
      [mcpRegistration(), mcpRegistration({ remoteToolName: 'second' })],
      [
        mcpRegistration(),
        mcpRegistration({
          remoteToolName: 'second',
          modelToolName: 'secondTool',
          authentication: 'bearer',
        }),
      ],
      [
        mcpRegistration({
          inputSchema: {
            type: 'object',
            description: 'x'.repeat(33 * 1024),
          },
        }),
      ],
    ];
    for (const registrations of cases) {
      expect(() =>
        readMcpToolRegistrations({
          EDUCANVAS_DEPLOYMENT_ENV: 'local',
          EDUCANVAS_MCP_TOOLS_JSON: JSON.stringify(registrations),
        }),
      ).toThrow(McpConfigurationError);
    }
  });

  it('高风险MCP必须声明write副作用', () => {
    expect(() =>
      readMcpToolRegistrations({
        EDUCANVAS_DEPLOYMENT_ENV: 'local',
        EDUCANVAS_MCP_TOOLS_JSON: JSON.stringify([
          mcpRegistration({
            capability: 'external.mcp.invoke',
            risk: 'l2',
            effect: 'read',
          }),
        ]),
      }),
    ).toThrow(McpConfigurationError);
  });
});
