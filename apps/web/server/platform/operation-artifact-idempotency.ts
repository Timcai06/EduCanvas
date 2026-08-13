import { createHash } from 'node:crypto';
import type { AssetVersionRepresentationIdentity } from '@educanvas/agent-core';

/** Only server-derived provenance identity is allowed into an Artifact request fingerprint. */
export interface GeneralTurnArtifactProvenanceSource {
  readonly assetId: string;
  readonly versionId: string;
  readonly representation: AssetVersionRepresentationIdentity | null;
}

/**
 * The semantic fields that can change the Artifact generation request.
 *
 * The two tools deliberately use one shared idempotency key, but each tool
 * supplies its own semantic fields. Optional fields are omitted from the
 * canonical material when they do not belong to that tool's request shape.
 */
export interface GeneralTurnArtifactSemanticRequest {
  readonly kind: string;
  readonly title: string;
  readonly instruction?: string;
  readonly prompt?: string;
  readonly size?: string;
  readonly provenance?: {
    readonly sources: readonly GeneralTurnArtifactProvenanceSource[];
  };
}

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | {
      readonly [key: string]: CanonicalValue;
    };

/** Stable JSON: object keys are sorted; arrays retain their semantic order. */
function canonicalize(value: CanonicalValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]!)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalSemanticRequest(
  request: GeneralTurnArtifactSemanticRequest,
): CanonicalValue {
  const material: Record<string, CanonicalValue> = {
    kind: request.kind,
    title: request.title,
  };
  if (request.instruction !== undefined)
    material.instruction = request.instruction;
  if (request.prompt !== undefined) material.prompt = request.prompt;
  if (request.size !== undefined) material.size = request.size;
  if (request.provenance !== undefined) {
    material.provenance = {
      sources: request.provenance.sources.map((source) => ({
        assetId: source.assetId,
        versionId: source.versionId,
        representation: source.representation as CanonicalValue,
      })),
    };
  }
  return material;
}

/**
 * A General Turn may persist at most one newly generated Artifact.
 *
 * Both text and image tools deliberately share this repository idempotency
 * identity. The database serializes concurrent calls; a later tool with a
 * different semantic request produces a different fingerprint and is rejected
 * by the repository's idempotency conflict boundary.
 */
export function generalTurnArtifactIdempotency(
  operationId: string,
  request: GeneralTurnArtifactSemanticRequest,
): {
  idempotencyKey: string;
  requestFingerprint: string;
} {
  const semanticRequest = canonicalSemanticRequest(request);
  return {
    idempotencyKey: `general-turn-artifact:${operationId}`,
    requestFingerprint: createHash('sha256')
      .update(
        canonicalize({
          schemaVersion: 'general-turn-artifact-idempotency.v2',
          operationId,
          request: semanticRequest,
        }),
        'utf8',
      )
      .digest('hex'),
  };
}
