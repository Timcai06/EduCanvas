import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createTelemetryRuntimeFromEnvironment } from './runtime';

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );

describe('OTLP telemetry runtime lifecycle', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it('真实OTLP HTTP失败只进入degraded且Turn仍正常结束', async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(503).end();
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('fixture_server_address_unavailable');
    }
    const runtime = createTelemetryRuntimeFromEnvironment(
      'educanvas-telemetry-test',
      {
        EDUCANVAS_DEPLOYMENT_ENV: 'test',
        EDUCANVAS_OTEL_ENABLED: 'true',
        EDUCANVAS_OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}/v1/traces`,
        EDUCANVAS_OTEL_SAMPLE_RATIO: '1',
        EDUCANVAS_OTEL_EXPORT_TIMEOUT_MS: '1000',
      },
    );
    const span = runtime.turnTrace.start({
      operationId: '00000000-0000-4000-8000-000000000001',
      traceId: 'application-trace-id',
      actorId: 'actor-never-export',
      agentId: 'agent-never-export',
      notebookId: 'notebook-never-export',
      conversationId: 'conversation-never-export',
      profileId: 'profile-never-export',
      entrypoint: 'tui',
    });

    expect(() => span.end('completed')).not.toThrow();
    await runtime.forceFlush();

    // 官方 OTLP exporter 会对 503 做有界重试；这里冻结“确实尝试导出”，
    // 不把其内部重试次数误当成 EduCanvas 的公共契约。
    expect(requests).toBeGreaterThanOrEqual(1);
    expect(runtime.health()).toEqual({
      status: 'degraded',
      failureCode: 'export_failed',
    });
    await runtime.shutdown();
  });
});
