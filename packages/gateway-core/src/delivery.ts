import { z } from 'zod';
import { gatewayOpaqueIdSchema, gatewayTimestampSchema } from './common';
import { gatewayFailureCodeSchema } from './events';

export const gatewayDeliveryStatuses = [
  'pending',
  'sent',
  'acknowledged',
  'failed',
  'expired',
] as const;
export const gatewayDeliveryStatusSchema = z.enum(gatewayDeliveryStatuses);

export const gatewayDeliveryReceiptSchema = z
  .object({
    deliveryId: gatewayOpaqueIdSchema,
    envelopeId: gatewayOpaqueIdSchema,
    operationId: gatewayOpaqueIdSchema,
    status: gatewayDeliveryStatusSchema,
    attempt: z.number().int().positive().max(100),
    occurredAt: gatewayTimestampSchema,
    externalMessageId: gatewayOpaqueIdSchema.nullable(),
    failureCode: gatewayFailureCodeSchema.nullable(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.status === 'failed' && receipt.failureCode === null) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Failed delivery requires a failure code',
      });
    }
    if (receipt.status !== 'failed' && receipt.failureCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Only failed delivery can have a failure code',
      });
    }
  });

export type GatewayDeliveryReceipt = z.infer<
  typeof gatewayDeliveryReceiptSchema
>;
