import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  telemetry: vi.fn(),
}));

vi.mock('@/server/telemetry/telemetry-runtime', () => ({
  getWebTelemetryRuntime: mocks.telemetry,
}));

import { GET } from './route';

const token = 'a'.repeat(32);
const request = (authorization?: string) =>
  new Request('http://localhost/api/v1/internal/metrics', {
    headers: authorization ? { authorization } : {},
  });

describe('GET /api/v1/internal/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EDUCANVAS_GATEWAY_INTERNAL_TOKEN = token;
    mocks.telemetry.mockReturnValue({
      health: () => ({ status: 'ready' }),
      metrics: {
        snapshot: () => ({
          counters: { web_search_replacements_total: 2 },
          histograms: {},
          gauges: {},
        }),
      },
    });
  });

  afterEach(() => {
    delete process.env.EDUCANVAS_GATEWAY_INTERNAL_TOKEN;
  });

  it('stays disabled when the shared internal token is absent', async () => {
    delete process.env.EDUCANVAS_GATEWAY_INTERNAL_TOKEN;
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(mocks.telemetry).not.toHaveBeenCalled();
  });

  it('rejects missing and incorrect bearer credentials', async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request(`Bearer ${'b'.repeat(32)}`))).status).toBe(401);
    expect(mocks.telemetry).not.toHaveBeenCalled();
  });

  it('returns only the low-cardinality runtime snapshot', async () => {
    const response = await GET(request(`Bearer ${token}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      telemetry: {
        health: { status: 'ready' },
        metrics: {
          counters: { web_search_replacements_total: 2 },
          histograms: {},
          gauges: {},
        },
      },
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('does not expose the internal token when telemetry is unavailable', async () => {
    mocks.telemetry.mockImplementation(() => {
      throw new Error(`secret ${token}`);
    });
    const response = await GET(request(`Bearer ${token}`));
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).not.toContain(token);
  });
});
