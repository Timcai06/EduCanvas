import 'server-only';

import { createHmac } from 'node:crypto';
import { DrizzleWebSessionRepository } from '@educanvas/db';
import {
  createDesktopAuthService,
  DesktopAuthError,
} from './desktop-auth-service';

/** Web BFF already holds the bootstrap secret; use a domain-separated HMAC key for auth codes. */
export function getDesktopAuthService() {
  const bootstrapSecret =
    process.env.EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN?.trim() ?? '';
  if (Buffer.byteLength(bootstrapSecret) < 32) {
    throw new DesktopAuthError('server_not_configured');
  }
  const secret = createHmac('sha256', bootstrapSecret)
    .update('educanvas.desktop.authorization-code.v1', 'utf8')
    .digest('hex');
  return createDesktopAuthService({
    repository: new DrizzleWebSessionRepository(),
    secret,
  });
}
