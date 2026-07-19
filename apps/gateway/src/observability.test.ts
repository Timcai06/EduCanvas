import { describe, expect, it } from 'vitest';
import { GatewayObservability, gatewayRouteLabel } from './observability';

describe('GatewayObservability', () => {
  it('uses a stable low-cardinality label for local onboarding', () => {
    expect(gatewayRouteLabel('POST', '/v1/local/onboard')).toBe(
      'local.onboard',
    );
  });

  it('uses bounded route labels and records no request content', () => {
    const records: unknown[] = [];
    let now = 10;
    const metrics = new GatewayObservability(
      (record) => records.push(record),
      () => now,
    );
    const finish = metrics.beginHttp({
      method: 'GET',
      route: gatewayRouteLabel(
        'GET',
        '/v1/client/operations/private-operation-id/events',
      ),
    });
    now = 16;
    finish(403);
    finish(500);

    expect(metrics.snapshot()).toEqual({
      httpRequestsTotal: 1,
      httpErrorsTotal: 1,
      activeHttpRequests: 0,
      operationEventsTotal: 0,
      operationTerminalsTotal: 0,
    });
    expect(records).toEqual([
      {
        event: 'gateway.http',
        method: 'GET',
        route: 'client.operation.events',
        status: 403,
        durationMs: 6,
      },
    ]);
    expect(JSON.stringify(records)).not.toContain('private-operation-id');
  });
});
