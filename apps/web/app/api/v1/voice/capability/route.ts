import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { resolveVoiceCapability } from '@/server/voice/voice-capability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const identity = await readAnonymousIdentity();
  if (!identity) {
    return Response.json(
      {
        checks: [
          { key: 'model', healthy: false },
          { key: 'connection', healthy: false },
          { key: 'consent', healthy: false },
          { key: 'retention', healthy: false },
          { key: 'deletion-worker', healthy: false },
        ],
        websocketUrl: null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  const capability = await resolveVoiceCapability(identity.studentId);
  return Response.json(capability, {
    headers: { 'cache-control': 'no-store' },
  });
}
