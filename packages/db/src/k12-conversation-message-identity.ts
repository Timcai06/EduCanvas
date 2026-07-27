import { createHash } from 'node:crypto';
import { isUuid } from './internal/identifiers';

export class K12ConversationDualWriteInvariantError extends Error {
  readonly code = 'k12_dual_write_invariant_failed';

  constructor() {
    super('K12 message dual-write invariant failed');
    this.name = 'K12ConversationDualWriteInvariantError';
  }
}

/**
 * 从 chat_messages.id 派生稳定的一对一平台消息 ID。
 * UUID v8 表示这是 SHA-256 自定义确定性布局，而不是随机 UUID v4。
 */
export function deterministicConversationMessageId(
  chatMessageId: string,
): string {
  if (!isUuid(chatMessageId)) {
    throw new K12ConversationDualWriteInvariantError();
  }
  const hash = createHash('sha256')
    .update(`k12-dual-write:v1:${chatMessageId.toLowerCase()}`)
    .digest();
  const byte6 = hash[6];
  const byte8 = hash[8];
  if (byte6 === undefined || byte8 === undefined) {
    throw new K12ConversationDualWriteInvariantError();
  }
  hash[6] = (byte6 & 0x0f) | 0x80;
  hash[8] = (byte8 & 0x3f) | 0x80;
  return [
    hash.subarray(0, 4).toString('hex'),
    hash.subarray(4, 6).toString('hex'),
    hash.subarray(6, 8).toString('hex'),
    hash.subarray(8, 10).toString('hex'),
    hash.subarray(10, 16).toString('hex'),
  ].join('-');
}
