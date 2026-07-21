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

/** TUI 等已认证客户端只能为一个明确的 Conversation 请求 Web 交接。 */
export const gatewayHandoffIssueRequestSchema = z
  .object({ conversationId: gatewayOpaqueIdSchema })
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
