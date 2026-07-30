import { createServer } from 'node:http';
import { readWebRuntimeConfig } from './config';
import { createWebRuntimeHandler } from './server';

const config = readWebRuntimeConfig();
const server = createServer(createWebRuntimeHandler(config));

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
