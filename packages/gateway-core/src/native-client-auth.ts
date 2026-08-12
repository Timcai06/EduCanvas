import { z } from 'zod';
import { gatewayOpaqueIdSchema } from './common';

export const gatewayDesktopClientId = 'educanvas-desktop' as const;
export const gatewayDesktopProtocol = 'educanvas' as const;
export const gatewayDesktopRedirectUri = 'educanvas://auth/callback' as const;

const base64Url43Schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const pkceVerifierSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/);

/** RFC 8252 native-app authorization request frozen for the packaged desktop client. */
export const gatewayDesktopAuthorizationQuerySchema = z
  .object({
    response_type: z.literal('code'),
    client_id: z.literal(gatewayDesktopClientId),
    redirect_uri: z.literal(gatewayDesktopRedirectUri),
    state: base64Url43Schema,
    code_challenge: base64Url43Schema,
    code_challenge_method: z.literal('S256'),
  })
  .strict();

export const gatewayDesktopAuthorizationCodeSchema = z
  .string()
  .regex(/^eca1\.[A-Za-z0-9_-]{16,768}\.[A-Za-z0-9_-]{43}$/);

/** Deep-link callbacks carry an authorization code and CSRF state only. */
export const gatewayDesktopCallbackSchema = z
  .object({
    code: gatewayDesktopAuthorizationCodeSchema,
    state: base64Url43Schema,
  })
  .strict();

export const gatewayDesktopSessionTokenSchema = z
  .string()
  .regex(/^ecs1_[A-Za-z0-9_-]{43}$/);

export const gatewayDesktopTokenExchangeRequestSchema = z
  .object({
    grant_type: z.literal('authorization_code'),
    client_id: z.literal(gatewayDesktopClientId),
    redirect_uri: z.literal(gatewayDesktopRedirectUri),
    code: gatewayDesktopAuthorizationCodeSchema,
    code_verifier: pkceVerifierSchema,
  })
  .strict();

export const gatewayDesktopTokenGrantSchema = z
  .object({
    access_token: gatewayDesktopSessionTokenSchema,
    token_type: z.literal('Bearer'),
    expires_at: z.string().datetime({ offset: true }),
    user_id: gatewayOpaqueIdSchema,
    notebook_id: gatewayOpaqueIdSchema,
    conversation_id: gatewayOpaqueIdSchema,
  })
  .strict();

export type GatewayDesktopAuthorizationQuery = z.infer<
  typeof gatewayDesktopAuthorizationQuerySchema
>;
export type GatewayDesktopTokenExchangeRequest = z.infer<
  typeof gatewayDesktopTokenExchangeRequestSchema
>;
export type GatewayDesktopTokenGrant = z.infer<
  typeof gatewayDesktopTokenGrantSchema
>;
