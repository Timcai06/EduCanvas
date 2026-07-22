import { getDb } from '../client';

/**
 * Gateway 数据仓储的共享持久化基元：统一的连接/事务类型与错误码。
 * 拆分自原 gateway-repository.ts，仅承载被多个 Gateway Repository 共用的边界类型，
 * 不包含任何具体仓储逻辑或事务编排。
 */

export type Database = ReturnType<typeof getDb>;
export type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

export class GatewayPersistenceError extends Error {
  constructor(
    readonly code:
      | 'identity_not_found'
      | 'route_not_found'
      | 'forbidden'
      | 'idempotency_conflict'
      | 'operation_not_found'
      | 'invalid_event_sequence',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayPersistenceError';
  }
}
