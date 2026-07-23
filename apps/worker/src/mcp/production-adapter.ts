import { readMcpToolRegistrations } from '@educanvas/mcp-runtime';
import type { OperationContinuationResumeAdapter } from '../tasks/continue-operation';
import { createMcpContinuationAdapter } from './continuation-adapter';

/** 缺配置或密钥时不注册伪Adapter，worker会用adapter_unavailable诚实失败。 */
export function createProductionMcpContinuationAdapters(): readonly OperationContinuationResumeAdapter[] {
  const key = process.env.EDUCANVAS_MCP_INTENT_ENCRYPTION_KEY?.trim();
  if (!key) return [];
  try {
    const registrations = readMcpToolRegistrations({
      EDUCANVAS_DEPLOYMENT_ENV: process.env.EDUCANVAS_DEPLOYMENT_ENV,
      EDUCANVAS_MCP_TOOLS_JSON: process.env.EDUCANVAS_MCP_TOOLS_JSON,
    });
    const adapter = createMcpContinuationAdapter({
      registrations,
      encryptionKey: key,
    });
    return adapter.capabilities.length > 0 ? [adapter] : [];
  } catch {
    return [];
  }
}
