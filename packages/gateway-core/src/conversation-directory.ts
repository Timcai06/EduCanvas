import { z } from 'zod';
import {
  gatewayAgentProfileIdSchema,
  notebookMembershipRoleSchema,
} from './routing';
import { gatewayOpaqueIdSchema, gatewayTimestampSchema } from './common';

export const gatewayConversationDirectoryCursorSchema = z
  .string()
  .max(520)
  .regex(/^gdc1\.[A-Za-z0-9_-]{1,512}$/);

export const gatewayConversationDirectoryEntrySchema = z
  .object({
    notebookId: gatewayOpaqueIdSchema,
    notebookTitle: z.string().min(1).max(300),
    conversationId: gatewayOpaqueIdSchema,
    title: z.string().min(1).max(300).nullable(),
    agentProfileId: gatewayAgentProfileIdSchema,
    membershipRole: notebookMembershipRoleSchema,
    lastActivityAt: gatewayTimestampSchema,
  })
  .strict();

export const gatewayConversationDirectoryPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    conversations: z.array(gatewayConversationDirectoryEntrySchema).max(50),
    nextCursor: gatewayConversationDirectoryCursorSchema.nullable(),
  })
  .strict();

export const gatewayConversationCreateRequestSchema = z
  .object({
    // 首次使用时目录可能尚无 Conversation，因而 renderer 无从推导 Notebook。
    // 缺省值由 Gateway 在当前用户可写的个人 Notebook 边界内解析。
    notebookId: gatewayOpaqueIdSchema.optional(),
    title: z.string().trim().min(1).max(300),
  })
  .strict();

export const gatewayConversationCreateResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    conversation: gatewayConversationDirectoryEntrySchema,
  })
  .strict();

export type GatewayConversationDirectoryEntry = z.infer<
  typeof gatewayConversationDirectoryEntrySchema
>;
export type GatewayConversationDirectoryPage = z.infer<
  typeof gatewayConversationDirectoryPageSchema
>;
export type GatewayConversationCreateRequest = z.infer<
  typeof gatewayConversationCreateRequestSchema
>;
export type GatewayConversationCreateResult = z.infer<
  typeof gatewayConversationCreateResultSchema
>;
