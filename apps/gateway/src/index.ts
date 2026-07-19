import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseEnv } from 'node:util';
import {
  DrizzleGatewayDirectoryRepository,
  DrizzleGatewayApprovalRepository,
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayNodeRepository,
  DrizzleGatewayOperationStore,
  DrizzleGatewayRouteResolver,
} from '@educanvas/db';
import {
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
const clientSessionSecret =
  config.sessionSecret ??
  (config.localOnboardingEnabled ? randomBytes(32).toString('hex') : null);
const clientSessionAuth = clientSessionSecret
  ? new GatewayClientSessionAuth(clientSessionSecret)
  : null;
const observability = new GatewayObservability((record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
});
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
    })}\n`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
