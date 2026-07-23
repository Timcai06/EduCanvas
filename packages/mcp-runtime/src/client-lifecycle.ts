import type {
  McpClientPort,
  McpCredentialBrokerPort,
  McpToolRegistration,
} from './contracts';
import { McpInvocationError } from './errors';
import type { McpProtocolSessionFactory } from './sdk-session';
import { canonicalMcpInputSchema } from './schema-validation';
import { McpStatusRegistry } from './status-registry';
import { StreamableHttpMcpSessionFactory } from './streamable-http-session';

const MAX_LIST_PAGES = 4;
const MAX_LISTED_TOOLS = 256;

function validAuthorization(value: string): boolean {
  return (
    value.startsWith('Bearer ') &&
    value.length >= 8 &&
    value.length <= 4_096 &&
    !value.includes('\r') &&
    !value.includes('\n')
  );
}

/** 每次调用建立短生命周期SDK会话，先验证远端Schema，再执行并可靠关闭。 */
export class LifecycleMcpClient implements McpClientPort {
  constructor(
    private readonly credentialBroker: McpCredentialBrokerPort,
    private readonly statuses: McpStatusRegistry,
    private readonly sessions: McpProtocolSessionFactory = new StreamableHttpMcpSessionFactory(),
  ) {}

  async callTool(input: Parameters<McpClientPort['callTool']>[0]) {
    const { registration, scope } = input;
    let authorization: string | undefined;
    if (registration.authentication === 'bearer') {
      if (!scope.credentialHandle) {
        this.statuses.set(registration.serverId, 'degraded', 'credential');
        throw new McpInvocationError('credential');
      }
      const credential = await this.credentialBroker
        .resolveAuthorization({
          actorId: scope.actorId,
          agentId: scope.agentId,
          serverId: registration.serverId,
          credentialHandle: scope.credentialHandle,
          signal: scope.signal,
        })
        .catch(() => null);
      if (!credential || !validAuthorization(credential.authorization)) {
        this.statuses.set(registration.serverId, 'degraded', 'credential');
        throw new McpInvocationError('credential');
      }
      authorization = credential.authorization;
    }

    const session = this.sessions.open({
      registration,
      ...(authorization ? { authorization } : {}),
    });
    try {
      await session.connect({
        signal: scope.signal,
        timeoutMs: registration.timeoutMs,
      });
      await this.assertRegisteredSchema(registration, session, scope.signal);
      const result = await session.callTool({
        name: registration.remoteToolName,
        arguments: input.arguments,
        signal: scope.signal,
        timeoutMs: registration.timeoutMs,
      });
      this.statuses.set(registration.serverId, 'ready');
      return result;
    } catch (error) {
      if (error instanceof McpInvocationError) {
        this.statuses.set(registration.serverId, 'degraded', error.failureCode);
        throw error;
      }
      this.statuses.set(registration.serverId, 'degraded', 'transport');
      throw new McpInvocationError('transport');
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  private async assertRegisteredSchema(
    registration: McpToolRegistration,
    session: ReturnType<McpProtocolSessionFactory['open']>,
    signal: AbortSignal,
  ): Promise<void> {
    const expected = canonicalMcpInputSchema(registration.inputSchema);
    let cursor: string | undefined;
    let matchedSchema: string | null = null;
    let listed = 0;
    const seenCursors = new Set<string>();
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await session.listTools({
        ...(cursor ? { cursor } : {}),
        signal,
        timeoutMs: registration.timeoutMs,
      });
      listed += result.tools.length;
      if (listed > MAX_LISTED_TOOLS) throw new McpInvocationError('protocol');
      for (const tool of result.tools.filter(
        (candidate) => candidate.name === registration.remoteToolName,
      )) {
        if (matchedSchema !== null) throw new McpInvocationError('protocol');
        matchedSchema = canonicalMcpInputSchema(tool.inputSchema);
        if (matchedSchema !== expected) {
          throw new McpInvocationError('protocol');
        }
      }
      cursor = result.nextCursor;
      if (!cursor) {
        if (matchedSchema !== null) return;
        break;
      }
      if (
        cursor.length > 1_024 ||
        seenCursors.has(cursor) ||
        page === MAX_LIST_PAGES - 1
      ) {
        throw new McpInvocationError('protocol');
      }
      seenCursors.add(cursor);
    }
    throw new McpInvocationError('protocol');
  }
}
