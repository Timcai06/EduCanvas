import { gatewayOpaqueIdSchema } from '@educanvas/gateway-core';
import { z } from 'zod';

const payloadSchema = z
  .object({
    t: z.string().datetime({ offset: true }),
    i: gatewayOpaqueIdSchema,
    r: z.enum(['user', 'assistant']),
  })
  .strict();

export interface MessageHistoryCursorValue {
  createdAt: Date;
  messageId: string;
  role: 'user' | 'assistant';
}

export function encodeMessageHistoryCursor(
  value: MessageHistoryCursorValue,
): string {
  return `gmh1.${Buffer.from(
    JSON.stringify({
      t: value.createdAt.toISOString(),
      i: value.messageId,
      r: value.role,
    }),
    'utf8',
  ).toString('base64url')}`;
}

export function decodeMessageHistoryCursor(
  cursor: string,
): MessageHistoryCursorValue | null {
  try {
    const [prefix, payload, extra] = cursor.split('.');
    if (prefix !== 'gmh1' || !payload || extra) return null;
    const decoded = Buffer.from(payload, 'base64url');
    if (decoded.toString('base64url') !== payload) return null;
    const value = payloadSchema.parse(JSON.parse(decoded.toString('utf8')));
    return {
      createdAt: new Date(value.t),
      messageId: value.i,
      role: value.r,
    };
  } catch {
    return null;
  }
}
