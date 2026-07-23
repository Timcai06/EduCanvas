/**
 * Gateway 请求指纹 — SHA256 确定性哈希。
 *
 * ## 用途
 *
 * 指纹用于幂等检测：同一指纹的重复请求回放已有结果。
 * 只哈希业务关键字段（actorUserId、agentId、routeHint、parts、replyTarget），
 * 不包含时间戳、envelopeId 等每次不同的字段。
 *
 * ## stableJson
 *
 * 对象 key 按字典序排列后 JSON 序列化，保证同义不同序的 JSON 产生相同哈希。
 */

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
