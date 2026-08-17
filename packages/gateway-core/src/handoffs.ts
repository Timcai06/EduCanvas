import { z } from 'zod';
import { gatewayOpaqueIdSchema, gatewayTimestampSchema } from './common';

/**
 * Handoff 凭证固定为 32-byte 无 padding base64url；固定长度既限制请求体，
 * 也避免把 Conversation ID 或其他可猜标识误当成跨客户端授权。
 */
export const gatewayHandoffTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * 与 canvas-protocol `canvasResourceKinds` 同步的本地镜像；gateway-core 不依赖
 * canvas-protocol，目标 id 一律按 uuid 校验（对应列均为 uuid）。
 */
export const gatewayHandoffResourceKinds = ['source', 'artifact'] as const;
export const gatewayHandoffResourceKindSchema = z.enum(
  gatewayHandoffResourceKinds,
);

/**
 * 一次性交接可精确指向的资源目标。`kind:'conversation'` 表示仅切对话（DP07
 * 语义）；message/artifact/resource 在 issue 时由服务端重验归属并绑定到凭证行，
 * 消费时不再接受客户端提供的目标。`versionId: null` 表示最新版本。
 */
export const gatewayHandoffTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('conversation') }).strict(),
  z.object({ kind: z.literal('message'), messageId: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal('artifact'),
      artifactId: z.uuid(),
      versionId: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('resource'),
      resourceKind: gatewayHandoffResourceKindSchema,
      resourceId: z.uuid(),
      versionId: z.uuid().nullable(),
    })
    .strict(),
]);

/**
 * 已认证客户端为一个明确的 Conversation 请求 Web 交接。`target` 可选，
 * 缺省即 conversation 级（TUI `createHandoff(conversationId)` 保持兼容）。
 */
export const gatewayHandoffIssueRequestSchema = z
  .object({
    conversationId: gatewayOpaqueIdSchema,
    target: gatewayHandoffTargetSchema.optional(),
  })
  .strict();

/**
 * 一次性交接响应只暴露短期 opaque 凭证和服务端到期时间；调用方不得解析凭证，
 * 也不得把它持久化为客户端身份或 Conversation 游标。
 */
export const gatewayHandoffCredentialSchema = z
  .object({
    token: gatewayHandoffTokenSchema,
    expiresAt: gatewayTimestampSchema,
  })
  .strict();

export type GatewayHandoffIssueRequest = z.infer<
  typeof gatewayHandoffIssueRequestSchema
>;
export type GatewayHandoffCredential = z.infer<
  typeof gatewayHandoffCredentialSchema
>;
export type GatewayHandoffTarget = z.infer<typeof gatewayHandoffTargetSchema>;
export type GatewayHandoffTargetKind = GatewayHandoffTarget['kind'];
