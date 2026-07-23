import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { gatewayDeliveries } from '../schema';
import { GatewayPersistenceError, type Database } from './persistence';

/**
 * Delivery 边界：以 envelope + 目标类型为幂等键原子登记并结算一次外发投递，
 * 已送达/已确认的 envelope 重放为幂等命中，避免重复外发。
 */
export class DrizzleGatewayDeliveryRepository {
  constructor(private readonly providedDatabase?: Database) {}

  private get database(): Database {
    return this.providedDatabase ?? getDb();
  }

  async begin(input: {
    operationId: string;
    envelopeId: string;
    targetKind: 'channel' | 'connection';
    target: Record<string, unknown>;
    now?: Date;
  }): Promise<{ deliveryId: string; replayed: boolean }> {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`gateway-delivery-v1:${input.envelopeId}:${input.targetKind}`}, 0))`,
      );
      const [existing] = await transaction
        .select({ id: gatewayDeliveries.id, status: gatewayDeliveries.status })
        .from(gatewayDeliveries)
        .where(
          and(
            eq(gatewayDeliveries.envelopeId, input.envelopeId),
            eq(gatewayDeliveries.targetKind, input.targetKind),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.status === 'sent' || existing.status === 'acknowledged') {
          return { deliveryId: existing.id, replayed: true };
        }
        await transaction
          .update(gatewayDeliveries)
          .set({
            attempt: sql`least(${gatewayDeliveries.attempt} + 1, 100)`,
            status: 'pending',
            externalMessageId: null,
            failureCode: null,
            updatedAt: now,
          })
          .where(eq(gatewayDeliveries.id, existing.id));
        return { deliveryId: existing.id, replayed: false };
      }
      const [delivery] = await transaction
        .insert(gatewayDeliveries)
        .values({
          operationId: input.operationId,
          envelopeId: input.envelopeId,
          targetKind: input.targetKind,
          target: input.target,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: gatewayDeliveries.id });
      if (!delivery) {
        throw new GatewayPersistenceError(
          'operation_not_found',
          'Delivery could not be created',
        );
      }
      return { deliveryId: delivery.id, replayed: false };
    });
  }

  async settle(input: {
    deliveryId: string;
    status: 'sent' | 'acknowledged' | 'failed' | 'expired';
    externalMessageId?: string | null;
    failureCode?: string | null;
    now?: Date;
  }): Promise<void> {
    if (input.status === 'failed' && !input.failureCode) {
      throw new GatewayPersistenceError(
        'invalid_event_sequence',
        'Failed delivery requires a failure code',
      );
    }
    const [updated] = await this.database
      .update(gatewayDeliveries)
      .set({
        status: input.status,
        externalMessageId: input.externalMessageId ?? null,
        failureCode: input.status === 'failed' ? input.failureCode : null,
        updatedAt: input.now ?? new Date(),
      })
      .where(eq(gatewayDeliveries.id, input.deliveryId))
      .returning({ id: gatewayDeliveries.id });
    if (!updated) {
      throw new GatewayPersistenceError(
        'operation_not_found',
        'Delivery settlement is invalid',
      );
    }
  }
}
