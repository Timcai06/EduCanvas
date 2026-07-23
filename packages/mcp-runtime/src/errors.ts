import type { McpServerStatus } from './contracts';

export type McpFailureCode = NonNullable<McpServerStatus['failureCode']>;

/** MCP边界只向上游暴露稳定错误码，远端正文、URL和Credential永不进入message。 */
export class McpInvocationError extends Error {
  override readonly name = 'McpInvocationError';

  constructor(readonly failureCode: McpFailureCode) {
    super(`mcp_${failureCode}`);
  }
}

/** 配置错误不携带原始JSON，生产组合根据此诚实禁用MCP。 */
export class McpConfigurationError extends Error {
  override readonly name = 'McpConfigurationError';

  constructor() {
    super('mcp_configuration_invalid');
  }
}

/** MCP服务器正常响应但工具声明失败；正文不会越过Adapter边界。 */
export class McpRemoteToolError extends Error {
  override readonly name = 'McpRemoteToolError';

  constructor() {
    super('mcp_tool_failed');
  }
}
