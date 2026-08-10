import 'server-only';

import {
  AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES,
  AudioVoiceCapabilityRepository,
} from '@educanvas/db';
import type { VoiceCapabilityCheck } from '@/features/voice';

const HEALTH_TIMEOUT_MS = 2_000;

interface VoiceCapabilityDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly repository?: Pick<
    AudioVoiceCapabilityRepository,
    'checkVoiceProcessingReadiness'
  >;
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
 * V17 服务端总闸门。所有维度 fail closed，且 ticket BFF 会在每次签发前
 * 重新调用；浏览器返回值只用于解释 UI，不构成授权事实。
 */
export async function resolveVoiceCapability(
  subjectUserId: string,
  dependencies: VoiceCapabilityDependencies = {},
): Promise<VoiceCapabilityResult> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const localDevelopment = env.EDUCANVAS_DEPLOYMENT_ENV?.trim() === 'local';
  const repository =
    dependencies.repository ??
    new AudioVoiceCapabilityRepository({
      guardianProofPolicy: localDevelopment
        ? AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES.allowSelfAttested
        : AUDIO_RETENTION_GUARDIAN_PROOF_POLICIES.verifiedOnly,
    });
  const gatewayUrl = configuredGatewayUrl(env);
  const [gatewayHealth, repositoryReadiness] = await Promise.all([
    readGatewayHealth(gatewayUrl, fetchImpl),
    repository.checkVoiceProcessingReadiness({ subjectUserId }).catch(() => ({
      consentActive: false,
      repositoryHealthy: false as const,
    })),
  ]);
  const clientTransportConfigured =
    Boolean(env.EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN?.trim()) &&
    gatewayUrl !== null;
  const deletionWorkerHealthy =
    env.EDUCANVAS_AUDIO_DELETION_WORKER_ENABLED?.trim() === 'true';
  const checks: readonly VoiceCapabilityCheck[] = [
    {
      key: 'model',
      healthy: gatewayHealth.streamingTranscriptionEnabled,
    },
    {
      key: 'connection',
      healthy: gatewayHealth.reachable && clientTransportConfigured,
    },
    { key: 'consent', healthy: repositoryReadiness.consentActive },
    { key: 'retention', healthy: repositoryReadiness.repositoryHealthy },
    { key: 'deletion-worker', healthy: deletionWorkerHealthy },
  ];
  return {
    checks,
    websocketUrl:
      checks.every((check) => check.healthy) && gatewayUrl
        ? toWebsocketUrl(gatewayUrl)
        : null,
  };
}
