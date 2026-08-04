import { z } from 'zod';

/**
 * Gateway 统一协议版本；不允许客户端自行协商版本，避免旧/new schema 并行带来解析漂移。
 */
export const gatewayProtocolVersion = 'gateway.v1' as const;
export const gatewayProtocolVersionSchema = z.literal(gatewayProtocolVersion);

/**
 * 通用 ID 形态约束：
 * - 不允许空串/极端长度；
 * - 允许的字符集避免日志污染、URL/路径注入和解析歧义；
 */
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
