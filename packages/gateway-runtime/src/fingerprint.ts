import { createHash } from 'node:crypto';
import type { GatewayInboundEnvelope } from '@educanvas/gateway-core';
import type { GatewayRequestFingerprintPort } from './ports';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export class Sha256GatewayRequestFingerprint implements GatewayRequestFingerprintPort {
  fingerprint(envelope: GatewayInboundEnvelope): string {
    const material = {
      actorUserId: envelope.principal.userId,
      agentId: envelope.principal.agentId,
      routeHint: envelope.routeHint,
      parts: envelope.parts,
      replyTarget: envelope.replyTarget,
    };
    return createHash('sha256').update(stableJson(material)).digest('hex');
  }
}
