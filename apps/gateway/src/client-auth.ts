import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { gatewayOpaqueIdSchema } from '@educanvas/gateway-core';
import { z } from 'zod';

const claimsSchema = z
  .object({
    version: z.literal(1),
    userId: gatewayOpaqueIdSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    tokenId: gatewayOpaqueIdSchema,
  })
  .strict()
  .refine((claims) => claims.expiresAt > claims.issuedAt);

export type GatewaySessionClaims = z.infer<typeof claimsSchema>;

const nodeClaimsSchema = z
  .object({
    version: z.literal(1),
    nodeId: gatewayOpaqueIdSchema,
    userId: gatewayOpaqueIdSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    tokenId: gatewayOpaqueIdSchema,
  })
  .strict()
  .refine((claims) => claims.expiresAt > claims.issuedAt);

export type GatewayNodeSessionClaims = z.infer<typeof nodeClaimsSchema>;

function signature(material: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(material).digest();
}

export class GatewayClientSessionAuth {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds = 24 * 60 * 60,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(secret) < 32) {
      throw new Error('Gateway session secret must be at least 32 bytes');
    }
  }

  issue(userId: string): { token: string; expiresAt: string } {
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);
    const claims = claimsSchema.parse({
      version: 1,
      userId,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + this.ttlSeconds,
      tokenId: randomUUID(),
    });
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signed = signature(payload, this.secret).toString('base64url');
    return {
      token: `${payload}.${signed}`,
      expiresAt: new Date(claims.expiresAt * 1_000).toISOString(),
    };
  }

  verify(token: string): GatewaySessionClaims | null {
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra !== undefined) return null;
    const expected = signature(payload, this.secret);
    let supplied: Buffer;
    try {
      supplied = Buffer.from(suppliedSignature, 'base64url');
    } catch {
      return null;
    }
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }
    try {
      const parsed = claimsSchema.parse(
        JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
      );
      const nowSeconds = Math.floor(this.now().getTime() / 1_000);
      return parsed.expiresAt > nowSeconds ? parsed : null;
    } catch {
      return null;
    }
  }
}

export class GatewayNodeSessionAuth {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds = 30 * 24 * 60 * 60,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(secret) < 32) {
      throw new Error('Gateway node secret must be at least 32 bytes');
    }
  }

  issue(input: { nodeId: string; userId: string }): {
    token: string;
    expiresAt: string;
  } {
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);
    const claims = nodeClaimsSchema.parse({
      version: 1,
      ...input,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + this.ttlSeconds,
      tokenId: randomUUID(),
    });
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return {
      token: `${payload}.${signature(payload, this.secret).toString('base64url')}`,
      expiresAt: new Date(claims.expiresAt * 1_000).toISOString(),
    };
  }

  verify(token: string): GatewayNodeSessionClaims | null {
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra !== undefined) return null;
    const expected = signature(payload, this.secret);
    const supplied = Buffer.from(suppliedSignature, 'base64url');
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }
    try {
      const claims = nodeClaimsSchema.parse(
        JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
      );
      return claims.expiresAt > Math.floor(this.now().getTime() / 1_000)
        ? claims
        : null;
    } catch {
      return null;
    }
  }
}

export function readBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return token && token.length <= 4_096 ? token : null;
}
