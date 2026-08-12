/**
 * A General Turn may persist at most one newly generated Artifact.
 *
 * Both text and image tools deliberately share this repository idempotency
 * identity. The database serializes concurrent calls; a later tool with a
 * different kind must reject the replay instead of presenting the first
 * Artifact as if it matched the later request.
 */
export function generalTurnArtifactIdempotency(operationId: string): {
  idempotencyKey: string;
  requestFingerprint: string;
} {
  return {
    idempotencyKey: `general-turn-artifact:${operationId}`,
    requestFingerprint: createHash('sha256')
      .update(`general-turn-artifact:${operationId}:v1`)
      .digest('hex'),
  };
}
import { createHash } from 'node:crypto';
