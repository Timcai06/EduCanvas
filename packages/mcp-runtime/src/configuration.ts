import { z } from 'zod';
import type { McpRuntimeEnvironment, McpToolRegistration } from './contracts';
import { McpConfigurationError } from './errors';
import { canonicalMcpInputSchema } from './schema-validation';

const MAX_CONFIGURATION_BYTES = 512 * 1024;
const serverIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9.-]*$/);
const toolNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][A-Za-z0-9_.-]*$/);
const remoteToolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const capabilitySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_.-]*$/);

const registrationSchema = z
  .object({
    serverId: serverIdSchema,
    endpoint: z.url().max(2_048),
    remoteToolName: remoteToolNameSchema,
    modelToolName: toolNameSchema,
    description: z.string().trim().min(1).max(500),
    capability: capabilitySchema,
    risk: z.enum(['l0', 'l1', 'l2', 'l3']),
    effect: z.enum(['read', 'write']),
    authentication: z.enum(['none', 'bearer']),
    inputSchema: z.record(z.string(), z.unknown()),
    timeoutMs: z.number().int().min(100).max(120_000),
  })
  .strict();

function validateEndpoint(endpoint: string, deployment: string): void {
  const url = new URL(endpoint);
  if (url.username || url.password || url.hash)
    throw new McpConfigurationError();
  if (deployment === 'production') {
    if (url.protocol !== 'https:') throw new McpConfigurationError();
    return;
  }
  if (url.protocol === 'https:') return;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'http:' || !loopback) throw new McpConfigurationError();
}

function ensureUniqueRegistrations(
  registrations: readonly McpToolRegistration[],
): void {
  const modelNames = new Set<string>();
  const remoteNames = new Set<string>();
  const authenticationByServer = new Map<string, string>();
  for (const registration of registrations) {
    const remoteKey = `${registration.serverId}:${registration.remoteToolName}`;
    if (
      modelNames.has(registration.modelToolName) ||
      remoteNames.has(remoteKey)
    ) {
      throw new McpConfigurationError();
    }
    modelNames.add(registration.modelToolName);
    remoteNames.add(remoteKey);
    const existing = authenticationByServer.get(registration.serverId);
    if (existing && existing !== registration.authentication) {
      throw new McpConfigurationError();
    }
    authenticationByServer.set(
      registration.serverId,
      registration.authentication,
    );
  }
}

/** 只接受服务端静态注册；远端annotations永远不能提升risk、effect或capability。 */
export function readMcpToolRegistrations(
  env: McpRuntimeEnvironment,
): readonly McpToolRegistration[] {
  const raw = env.EDUCANVAS_MCP_TOOLS_JSON?.trim();
  if (!raw) return [];
  if (Buffer.byteLength(raw, 'utf8') > MAX_CONFIGURATION_BYTES) {
    throw new McpConfigurationError();
  }
  try {
    const registrations = z
      .array(registrationSchema)
      .max(32)
      .parse(JSON.parse(raw)) as McpToolRegistration[];
    for (const registration of registrations) {
      validateEndpoint(
        registration.endpoint,
        env.EDUCANVAS_DEPLOYMENT_ENV?.trim() || 'development',
      );
      canonicalMcpInputSchema(registration.inputSchema);
      if (
        (registration.risk === 'l2' || registration.risk === 'l3') &&
        (registration.effect !== 'write' ||
          registration.capability !== 'external.mcp.invoke')
      ) {
        throw new McpConfigurationError();
      }
    }
    ensureUniqueRegistrations(registrations);
    return registrations;
  } catch (error) {
    if (error instanceof McpConfigurationError) throw error;
    throw new McpConfigurationError();
  }
}
