import type { McpToolRegistration } from './contracts';

export const TEST_INPUT_SCHEMA = {
  type: 'object',
  properties: { query: { type: 'string', maxLength: 20 } },
  required: ['query'],
  additionalProperties: false,
} as const;

export function mcpRegistration(
  overrides: Partial<McpToolRegistration> = {},
): McpToolRegistration {
  return {
    serverId: 'study-tools',
    endpoint: 'http://127.0.0.1:4321/mcp',
    remoteToolName: 'lookup',
    modelToolName: 'studyLookup',
    description: '查询可信配置的学习资料',
    capability: 'knowledge.lookup',
    risk: 'l0',
    effect: 'read',
    authentication: 'none',
    inputSchema: TEST_INPUT_SCHEMA,
    timeoutMs: 2_000,
    ...overrides,
  };
}
