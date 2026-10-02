export class GatewayRuntimeError extends Error {
  constructor(
    readonly code:
      | 'FORBIDDEN'
      | 'ROUTE_NOT_FOUND'
      | 'IDEMPOTENCY_CONFLICT'
      | 'CAPABILITY_UNAVAILABLE'
      | 'INVALID_EVENT_SEQUENCE'
      | 'OPERATION_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayRuntimeError';
  }
}
