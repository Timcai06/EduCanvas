import { gatewayOpaqueIdSchema } from '@educanvas/gateway-core';
import { z } from 'zod';

const payloadSchema = z
  .object({
    t: z.string().datetime({ offset: true }),
    i: gatewayOpaqueIdSchema,
  })
  .strict();

export interface ConversationDirectoryCursorValue {
  lastActivityAt: Date;
  conversationId: string;
}

export function encodeConversationDirectoryCursor(
  value: ConversationDirectoryCursorValue,
): string {
  return `gdc1.${Buffer.from(
    JSON.stringify({
      t: value.lastActivityAt.toISOString(),
      i: value.conversationId,
    }),
    'utf8',
  ).toString('base64url')}`;
}

export function decodeConversationDirectoryCursor(
  cursor: string,
): ConversationDirectoryCursorValue | null {
  try {
    const [prefix, payload, extra] = cursor.split('.');
    if (prefix !== 'gdc1' || !payload || extra) return null;
    const decoded = Buffer.from(payload, 'base64url');
    if (decoded.toString('base64url') !== payload) return null;
    const value = payloadSchema.parse(JSON.parse(decoded.toString('utf8')));
    const lastActivityAt = new Date(value.t);
    return { lastActivityAt, conversationId: value.i };
  } catch {
    return null;
  }
}
