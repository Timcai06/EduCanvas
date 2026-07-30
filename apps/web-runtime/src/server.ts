import { DrizzleWebRuntimeRunRepository } from '@educanvas/db';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderHostPage, renderHostScript } from './host-page';
import type { WebRuntimeConfig } from './config';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function headers(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=()',
  );
}

function json(response: ServerResponse, status: number, value: unknown): void {
  headers(response);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > 8 * 1024) throw new Error('request_too_large');
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function bootstrapInput(
  value: unknown,
): { runId: string; bootstrapToken: string } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'bootstrapToken,runId' ||
    typeof record.runId !== 'string' ||
    !UUID.test(record.runId) ||
    typeof record.bootstrapToken !== 'string' ||
    !TOKEN.test(record.bootstrapToken)
  ) {
    return null;
  }
  return {
    runId: record.runId,
    bootstrapToken: record.bootstrapToken,
  };
}

export function createWebRuntimeHandler(
  config: WebRuntimeConfig,
  repository: Pick<
    DrizzleWebRuntimeRunRepository,
    'claimBootstrap'
  > = new DrizzleWebRuntimeRunRepository(),
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', config.publicOrigin);
      if (request.method === 'GET' && url.pathname === '/health') {
        json(response, 200, {
          status: 'ok',
          isolationRequirement: 'cross-site-configured',
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/host') {
        headers(response);
        response.statusCode = 200;
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.setHeader(
          'content-security-policy',
          /* about:srcdoc inherits this policy before its stricter meta CSP is parsed.
             Inline/blob are required only for the generated sandbox bootstrap; the
             outer document contains no untrusted markup and loads its bridge from self. */
          `default-src 'none'; connect-src 'self'; frame-src 'self'; child-src 'self'; form-action 'none'; base-uri 'none'; object-src 'none'; worker-src 'none'; script-src 'self' 'unsafe-inline' blob:; style-src 'unsafe-inline'; frame-ancestors ${config.webOrigin}`,
        );
        response.end(renderHostPage(config));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/host.js') {
        headers(response);
        response.statusCode = 200;
        response.setHeader(
          'content-type',
          'application/javascript; charset=utf-8',
        );
        response.end(renderHostScript());
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/bootstrap') {
        const parsed = bootstrapInput(await body(request));
        if (!parsed) {
          json(response, 404, { error: { code: 'resource_not_found' } });
          return;
        }
        const claimed = await repository.claimBootstrap(parsed);
        json(response, 200, {
          binding: {
            protocolVersion: 'educanvas.web-runtime.v1',
            runtimeId: claimed.run.runtimeId,
            notebookId: claimed.run.notebookId,
            artifactVersionId: claimed.run.artifactVersionId,
            artifactContentHash: claimed.run.artifactContentHash,
          },
          content: claimed.content,
        });
        return;
      }
      json(response, 404, { error: { code: 'resource_not_found' } });
    })().catch(() => {
      if (!response.headersSent) {
        json(response, 404, { error: { code: 'resource_not_found' } });
      } else {
        response.destroy();
      }
    });
  };
}
