import { z } from 'zod';
import { agentMessagePartSchema } from '@educanvas/agent-core';
import { gatewayCitationSchema } from './citations';
import { gatewayOpaqueIdSchema, gatewayTimestampSchema } from './common';

/**
 * Conversation Message 历史分页游标。与目录游标（gdc1）同构：前缀 + base64url(payload)，
 * 指向当前已加载窗口里最旧的一条消息，用于「向上加载更早页」。
 */
export const gatewayMessageHistoryCursorSchema = z
  .string()
  .max(520)
  .regex(/^gmh1\.[A-Za-z0-9_-]{1,512}$/);

export const gatewayMessageRoleSchema = z.enum(['user', 'assistant']);

export const gatewayMessageStatusSchema = z.enum([
  'pending',
  'streaming',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

/**
 * 服务端 canonical Message 的历史投影。messageId 是跨客户端稳定的事实主键；
 * clientMessageId 让桌面端的乐观 User Message 能按同一请求身份去重。
 */
export const gatewayMessageHistoryEntrySchema = z
  .object({
    messageId: gatewayOpaqueIdSchema,
    clientMessageId: gatewayOpaqueIdSchema,
    role: gatewayMessageRoleSchema,
    status: gatewayMessageStatusSchema,
    content: z.string().max(64_000),
    parts: z.array(agentMessagePartSchema).max(64),
    citations: z.array(gatewayCitationSchema).max(99),
    createdAt: gatewayTimestampSchema,
    completedAt: gatewayTimestampSchema.nullable(),
  })
  .strict();

export const gatewayMessageHistoryPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    messages: z.array(gatewayMessageHistoryEntrySchema).max(100),
    nextCursor: gatewayMessageHistoryCursorSchema.nullable(),
  })
  .strict();

export type GatewayMessageHistoryEntry = z.infer<
  typeof gatewayMessageHistoryEntrySchema
>;
export type GatewayMessageHistoryPage = z.infer<
  typeof gatewayMessageHistoryPageSchema
>;
export type GatewayMessageRole = z.infer<typeof gatewayMessageRoleSchema>;
export type GatewayMessageStatus = z.infer<typeof gatewayMessageStatusSchema>;
