import type {
  McpRuntime,
  McpRuntimeEnvironment,
  McpRuntimeOptions,
  McpToolRegistration,
} from './contracts';
import { readMcpToolRegistrations } from './configuration';
import { DenyMcpCredentialBroker } from './credential-broker';
import { LifecycleMcpClient } from './client-lifecycle';
import { McpConfigurationError } from './errors';
import { McpStatusRegistry } from './status-registry';
import { createMcpToolAdapters } from './tool-adapter';
import { AesGcmMcpIntentCipher } from './intent-codec';

function serverRegistrations(
  registrations: readonly McpToolRegistration[],
): ReadonlyMap<string, readonly McpToolRegistration[]> {
  const grouped = new Map<string, McpToolRegistration[]>();
  for (const registration of registrations) {
    const existing = grouped.get(registration.serverId) ?? [];
    existing.push(registration);
    grouped.set(registration.serverId, existing);
  }
  return grouped;
}

/** 无配置、非法配置和缺Credential都返回可观测的诚实禁用状态，不拖垮聊天主链。 */
export function createMcpRuntimeFromEnvironment(
  env?: McpRuntimeEnvironment,
  options: McpRuntimeOptions = {},
): McpRuntime {
  const statuses = new McpStatusRegistry(options.now);
  const environment = env ?? {
    EDUCANVAS_DEPLOYMENT_ENV: process.env.EDUCANVAS_DEPLOYMENT_ENV,
    EDUCANVAS_MCP_TOOLS_JSON: process.env.EDUCANVAS_MCP_TOOLS_JSON,
    EDUCANVAS_MCP_INTENT_ENCRYPTION_KEY:
      process.env.EDUCANVAS_MCP_INTENT_ENCRYPTION_KEY,
  };
  let registrations: readonly McpToolRegistration[];
  try {
    registrations = readMcpToolRegistrations(environment);
  } catch (error) {
    if (!(error instanceof McpConfigurationError)) throw error;
    statuses.set('mcp.configuration', 'disabled', 'configuration');
    return { adapters: [], capabilities: [], statuses: () => statuses.list() };
  }
  if (registrations.length === 0) {
    statuses.set('mcp', 'disabled');
    return { adapters: [], capabilities: [], statuses: () => statuses.list() };
  }

  const enabled: McpToolRegistration[] = [];
  let intentCipher = options.intentCipher;
  if (!intentCipher && environment.EDUCANVAS_MCP_INTENT_ENCRYPTION_KEY) {
    try {
      intentCipher = AesGcmMcpIntentCipher.fromBase64(
        environment.EDUCANVAS_MCP_INTENT_ENCRYPTION_KEY,
      );
    } catch {
      statuses.set('mcp.durability', 'disabled', 'durability');
    }
  }
  const approval =
    options.durableIntents && options.approvalIntents && intentCipher
      ? {
          durableIntents: options.durableIntents,
          approvalIntents: options.approvalIntents,
          cipher: intentCipher,
          now: options.now ?? (() => new Date()),
        }
      : undefined;
  for (const [serverId, tools] of serverRegistrations(registrations)) {
    const requiresCredential = tools[0]?.authentication === 'bearer';
    if (requiresCredential && !options.credentialBroker) {
      statuses.set(serverId, 'disabled', 'credential');
      continue;
    }
    statuses.set(serverId, 'idle');
    for (const tool of tools) {
      if ((tool.risk === 'l2' || tool.risk === 'l3') && !approval) {
        statuses.set(`${serverId}.durability`, 'disabled', 'durability');
        continue;
      }
      enabled.push(tool);
    }
  }
  const broker = options.credentialBroker ?? new DenyMcpCredentialBroker();
  const client = options.client ?? new LifecycleMcpClient(broker, statuses);
  const adapters = createMcpToolAdapters(enabled, client, statuses, approval);
  return {
    adapters,
    capabilities: [...new Set(enabled.map((item) => item.capability))].sort(),
    statuses: () => statuses.list(),
  };
}
