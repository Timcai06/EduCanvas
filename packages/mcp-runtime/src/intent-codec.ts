import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import type {
  McpIntentCipherPort,
  McpIntentMetadata,
  McpSealedIntentPayload,
} from './contracts';

const MAX_INTENT_PAYLOAD_BYTES = 256 * 1024;
const payloadSchema = z
  .object({
    arguments: z.record(z.string(), z.unknown()),
    credentialHandle: z.string().min(1).max(256).nullable(),
  })
  .strict();

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

/** AAD绑定全部权威范围；搬移密文到另一Operation或工具会直接验签失败。 */
export function mcpIntentAssociatedData(metadata: McpIntentMetadata): Buffer {
  return Buffer.from(canonical(metadata), 'utf8');
}

export class AesGcmMcpIntentCipher implements McpIntentCipherPort {
  private readonly digestKey: Buffer;

  constructor(private readonly key: Buffer) {
    if (key.byteLength !== 32) throw new Error('mcp_intent_key_invalid');
    this.digestKey = Buffer.from(
      hkdfSync(
        'sha256',
        key,
        Buffer.alloc(0),
        'educanvas-mcp-intent-digest-v1',
        32,
      ),
    );
  }

  semanticsHash(input: Parameters<McpIntentCipherPort['semanticsHash']>[0]) {
    return this.digest('semantics-v1', Buffer.from(canonical(input), 'utf8'));
  }

  static fromBase64(value: string): AesGcmMcpIntentCipher {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new Error('mcp_intent_key_invalid');
    }
    return new AesGcmMcpIntentCipher(Buffer.from(value, 'base64'));
  }

  seal(
    input: Parameters<McpIntentCipherPort['seal']>[0],
  ): McpSealedIntentPayload {
    const plaintext = Buffer.from(
      canonical(payloadSchema.parse(input.payload)),
    );
    if (plaintext.byteLength > MAX_INTENT_PAYLOAD_BYTES) {
      throw new Error('mcp_intent_payload_too_large');
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(mcpIntentAssociatedData(input.metadata));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return {
      keyVersion: 'v1',
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      payloadHash: this.digest('payload-v1', plaintext),
    };
  }

  open(input: Parameters<McpIntentCipherPort['open']>[0]) {
    const nonce = Buffer.from(input.sealedPayload.nonce, 'base64');
    const ciphertext = Buffer.from(input.sealedPayload.ciphertext, 'base64');
    const tag = Buffer.from(input.sealedPayload.authTag, 'base64');
    if (nonce.byteLength !== 12 || tag.byteLength !== 16) {
      throw new Error('mcp_intent_ciphertext_invalid');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAAD(mcpIntentAssociatedData(input.metadata));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const expectedHash = Buffer.from(
      this.digest('payload-v1', plaintext),
      'hex',
    );
    const storedHash = Buffer.from(input.sealedPayload.payloadHash, 'hex');
    if (
      plaintext.byteLength > MAX_INTENT_PAYLOAD_BYTES ||
      storedHash.byteLength !== expectedHash.byteLength ||
      !timingSafeEqual(storedHash, expectedHash)
    ) {
      throw new Error('mcp_intent_ciphertext_invalid');
    }
    return payloadSchema.parse(JSON.parse(plaintext.toString('utf8')));
  }

  private digest(domain: string, value: Buffer): string {
    return createHmac('sha256', this.digestKey)
      .update(domain, 'utf8')
      .update('\u0000', 'utf8')
      .update(value)
      .digest('hex');
  }
}
