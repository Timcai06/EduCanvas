import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseEnv } from 'node:util';
import {
  DrizzleGatewayDirectoryRepository,
  DrizzleGatewayApprovalRepository,
  DrizzleGatewayConnectionRepository,
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayHandoffRepository,
  DrizzleGatewayNodeRepository,
  DrizzleGatewayOperationStore,
  DrizzleGatewayRouteResolver,
} from '@educanvas/db';
import {
  createDefaultGatewayConnectionProviders,
  GatewayConnectionService,
  GatewayService,
  Sha256GatewayRequestFingerprint,
} from '@educanvas/gateway-runtime';
import { readGatewayConfig } from './config';
import { createGatewayHttpHandler } from './server';
import { GatewayAgentTurnRunner } from './agent-runner';
import {
  GatewayClientSessionAuth,
  GatewayNodeSessionAuth,
} from './client-auth';
import { GatewayObservability } from './observability';
import { getGatewayTelemetryRuntime } from './telemetry';

function loadWorkspaceEnvFiles(): void {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) break;
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
  for (const name of ['.env', '.env.local']) {
    const file = path.join(current, name);
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] ??= value;
    }
  }
}

loadWorkspaceEnvFiles();
const config = readGatewayConfig();
const operationStore = new DrizzleGatewayOperationStore();
const identities = new DrizzleGatewayIdentityRepository();
const directory = new DrizzleGatewayDirectoryRepository();
const connections = new GatewayConnectionService(
  new DrizzleGatewayConnectionRepository(),
  createDefaultGatewayConnectionProviders({
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
  }),
);
const clientSessionSecret =
  config.sessionSecret ??
  (config.localOnboardingEnabled ? randomBytes(32).toString('hex') : null);
const clientSessionAuth = clientSessionSecret
  ? new GatewayClientSessionAuth(clientSessionSecret)
  : null;
const observability = new GatewayObservability((record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
});
const telemetry = getGatewayTelemetryRuntime();
const service = new GatewayService(
  new DrizzleGatewayRouteResolver(),
  operationStore,
  new GatewayAgentTurnRunner(),
  new Sha256GatewayRequestFingerprint(),
);
const server = createServer(
  createGatewayHttpHandler({
    service,
    internalToken: config.internalToken,
    clientTransport: clientSessionAuth
      ? {
          bootstrapToken: config.bootstrapToken,
          sessionAuth: clientSessionAuth,
          identities,
          directory,
          localOnboarding: config.localOnboardingEnabled
            ? {
                userId: config.localUserId,
                ensureWorkspace: (userId) =>
                  directory.ensurePersonalWorkspace({ userId }),
              }
            : null,
          approvals: new DrizzleGatewayApprovalRepository(),
          operations: operationStore,
          handoffs: new DrizzleGatewayHandoffRepository(),
          connections,
        }
      : null,
    nodeTransport:
      config.bootstrapToken && config.sessionSecret
        ? {
            bootstrapToken: config.bootstrapToken,
            sessionAuth: new GatewayNodeSessionAuth(config.sessionSecret),
            nodes: new DrizzleGatewayNodeRepository(),
          }
        : null,
    observability,
  }),
);

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `${JSON.stringify({
      event: 'gateway.started',
      host: config.host,
      port: config.port,
      internalTransportEnabled: config.internalToken !== null,
      clientTransportEnabled: clientSessionAuth !== null,
      localOnboardingEnabled: config.localOnboardingEnabled,
      telemetry: telemetry.health(),
    })}\n`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      void telemetry.shutdown().finally(() => process.exit(0));
    });
  });
}
