import { createServer } from 'node:http';
import { readWebRuntimeConfig } from './config';
import { createWebRuntimeHandler } from './server';

/** Parse env and build HTTP handler; startup logs machine-readable event for supervisors. */
const config = readWebRuntimeConfig();
const server = createServer(createWebRuntimeHandler(config));

/**
 * Start isolated runtime process listener.
 * On success we print a structured boot event consumed by orchestration tooling.
 * On SIGINT/SIGTERM we close server then exit to avoid dangling sockets.
 */
server.listen(config.port, config.host, () => {
  process.stdout.write(
    `${JSON.stringify({
      event: 'web_runtime.started',
      host: config.host,
      port: config.port,
      publicOrigin: config.publicOrigin,
      webOrigin: config.webOrigin,
      isolationRequirement: 'cross-site-configured',
    })}\n`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
