import { z } from 'zod';

export const gatewayProtocolVersion = 'gateway.v1' as const;
export const gatewayProtocolVersionSchema = z.literal(gatewayProtocolVersion);

export const gatewayOpaqueIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const gatewayTimestampSchema = z.string().datetime({ offset: true });

export const gatewayIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const gatewayJsonValueSchema: z.ZodType<
  | null
  | boolean
  | number
  | string
  | readonly unknown[]
  | { readonly [key: string]: unknown }
> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(gatewayJsonValueSchema),
    z.record(z.string(), gatewayJsonValueSchema),
  ]),
);

export type GatewayJsonValue = z.infer<typeof gatewayJsonValueSchema>;
