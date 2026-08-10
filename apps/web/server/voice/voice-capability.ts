import 'server-only';

import type { VoiceCapabilityCheck } from '@/features/voice';

const HEALTH_TIMEOUT_MS = 2_000;

interface VoiceCapabilityDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
}

export interface VoiceCapabilityResult {
  readonly checks: readonly VoiceCapabilityCheck[];
  /** 浏览器可见的公开 WS 入口；能力关闭时不返回。 */
  readonly websocketUrl: string | null;
}

function configuredGatewayUrl(env: NodeJS.ProcessEnv): URL | null {
  const raw = env.EDUCANVAS_GATEWAY_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function toWebsocketUrl(gatewayUrl: URL): string {
  const url = new URL('/v1/client/streaming-transcription', gatewayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

interface GatewayHealth {
  readonly reachable: boolean;
  readonly streamingTranscriptionEnabled: boolean;
}

async function readGatewayHealth(
  gatewayUrl: URL | null,
  fetchImpl: typeof fetch,
): Promise<GatewayHealth> {
  const unavailable: GatewayHealth = {
    reachable: false,
    streamingTranscriptionEnabled: false,
  };
  if (gatewayUrl === null) return unavailable;
  try {
    const response = await fetchImpl(new URL('/healthz', gatewayUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return unavailable;
    const body = (await response.json()) as Record<string, unknown>;
    const reachable =
      body.service === 'educanvas-gateway' &&
      body.status === 'ok' &&
      body.protocol === 'gateway.v1';
    return {
      reachable,
      streamingTranscriptionEnabled:
        reachable && body.streamingTranscriptionEnabled === true,
    };
  } catch {
    return unavailable;
  }
}

/**
 * V17 服务端基础设施闸门。流式 PCM 不落盘，所以这里只检查真实模型和
 * Gateway 连接；若未来保留原始音频，必须另走 V11/V14/V15 的同意与留存
 * 契约。ticket BFF 会在每次签发前重查，浏览器结果不构成授权事实。
 */
export async function resolveVoiceCapability(
  dependencies: VoiceCapabilityDependencies = {},
): Promise<VoiceCapabilityResult> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const gatewayUrl = configuredGatewayUrl(env);
  const gatewayHealth = await readGatewayHealth(gatewayUrl, fetchImpl);
  const clientTransportConfigured =
    Boolean(env.EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN?.trim()) &&
    gatewayUrl !== null;
  const checks: readonly VoiceCapabilityCheck[] = [
    {
      key: 'model',
      healthy: gatewayHealth.streamingTranscriptionEnabled,
    },
    {
      key: 'connection',
      healthy: gatewayHealth.reachable && clientTransportConfigured,
    },
  ];
  return {
    checks,
    websocketUrl:
      checks.every((check) => check.healthy) && gatewayUrl
        ? toWebsocketUrl(gatewayUrl)
        : null,
  };
}
