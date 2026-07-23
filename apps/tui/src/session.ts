import {
  GatewayBootstrapClient,
  GatewayClient,
  GatewayClientError,
  type GatewayConversationEntry,
} from '@educanvas/gateway-client';
import {
  loadConfig as loadStoredConfig,
  saveConfig as saveStoredConfig,
  type TuiSessionConfig,
} from './config';

interface SessionDependencies {
  fetcher?: typeof fetch;
  loadConfig?: () => Promise<TuiSessionConfig>;
  saveConfig?: (config: TuiSessionConfig) => Promise<void>;
}

export interface AuthenticatedGatewaySession {
  client: GatewayClient;
  conversations: readonly GatewayConversationEntry[];
}

function isLoopbackGateway(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname;
  return (
    hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost'
  );
}

function isUnauthenticated(error: unknown): boolean {
  return (
    error instanceof GatewayClientError &&
    error.status === 401 &&
    error.code === 'UNAUTHENTICATED'
  );
}

async function onboardLocal(
  baseUrl: string,
  dependencies: Required<SessionDependencies>,
): Promise<AuthenticatedGatewaySession> {
  const session = await new GatewayBootstrapClient(
    baseUrl,
    dependencies.fetcher,
  ).onboardLocal();
  const config = {
    baseUrl,
    userId: session.userId,
    token: session.token,
    expiresAt: session.expiresAt,
  };
  await dependencies.saveConfig(config);
  const client = new GatewayClient(
    baseUrl,
    session.token,
    dependencies.fetcher,
  );
  return { client, conversations: await client.listConversations() };
}

export async function establishGatewaySession(
  fallbackBaseUrl: string,
  overrides: SessionDependencies = {},
): Promise<AuthenticatedGatewaySession> {
  const dependencies: Required<SessionDependencies> = {
    fetcher: overrides.fetcher ?? fetch,
    loadConfig: overrides.loadConfig ?? (() => loadStoredConfig()),
    saveConfig: overrides.saveConfig ?? ((config) => saveStoredConfig(config)),
  };

  let config: TuiSessionConfig;
  try {
    config = await dependencies.loadConfig();
    if (Date.parse(config.expiresAt) <= Date.now()) throw new Error('expired');
  } catch {
    return onboardLocal(fallbackBaseUrl, dependencies);
  }

  const client = new GatewayClient(
    config.baseUrl,
    config.token,
    dependencies.fetcher,
  );
  try {
    return { client, conversations: await client.listConversations() };
  } catch (error) {
    if (!isLoopbackGateway(config.baseUrl) || !isUnauthenticated(error)) {
      throw error;
    }
    return onboardLocal(config.baseUrl, dependencies);
  }
}
