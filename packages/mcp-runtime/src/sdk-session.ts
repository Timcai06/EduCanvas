import type { McpToolRegistration } from './contracts';

export interface McpListedTool {
  name: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

/** 官方SDK会话被压缩到这个可测试Port，协议类型不会反向泄漏进Tool Kernel。 */
export interface McpProtocolSession {
  connect(input: { signal: AbortSignal; timeoutMs: number }): Promise<void>;
  listTools(input: {
    cursor?: string;
    signal: AbortSignal;
    timeoutMs: number;
  }): Promise<{ tools: readonly McpListedTool[]; nextCursor?: string }>;
  callTool(input: {
    name: string;
    arguments: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
    timeoutMs: number;
  }): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpProtocolSessionFactory {
  open(input: {
    registration: McpToolRegistration;
    authorization?: string;
  }): McpProtocolSession;
}
