import type { McpCredentialBrokerPort, McpCredentialScope } from './contracts';

/** 默认拒绝所有Credential；接入真实Broker前Bearer工具不会被生产组合暴露。 */
export class DenyMcpCredentialBroker implements McpCredentialBrokerPort {
  async resolveAuthorization(_scope: McpCredentialScope): Promise<null> {
    return null;
  }
}
