import { DrizzleWebRuntimeRunRepository } from '@educanvas/db';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderHostPage, renderHostScript } from './host-page';
import type { WebRuntimeConfig } from './config';

/** runId in bootstrap payload follows UUID v4-like 36-char format. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** bootstrapToken is fixed length for short-lived capability checks. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Add security headers shared by success/error responses.
 * `cache-control: no-store` ensures bootstrap/host outputs are not cached.
 */
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

/**
 * Read raw request body with hard size cap (8KiB).
 * This path is bootstrap-only, so large bodies are rejected before parse.
 */
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

/**
 * Validate bootstrap envelope shape and token formats without throwing.
 * Returns normalized typed value only when keys and formats are exact-match.
 */
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

/**
 * Build runtime HTTP handler:
 * - GET /health: liveness + isolation contract marker
 * - GET /host: host shell page (with strict CSP)
 * - GET /host.js: immutable bootstrap script
 * - POST /api/bootstrap: claim run content by one-time token
 * Any non-expected input is collapsed to resource_not_found to avoid leaking details.
 */
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
