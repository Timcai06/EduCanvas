import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { readExperienceMode } from '@/server/experience-mode';
import { resolveVoiceCapability } from '@/server/voice/voice-capability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const [identity, mode] = await Promise.all([
    readAnonymousIdentity(),
    readExperienceMode(),
  ]);
  if (!identity || mode === null) {
    return Response.json(
      {
        checks: [
          { key: 'model', healthy: false },
          { key: 'speech', healthy: false },
          { key: 'connection', healthy: false },
        ],
        websocketUrl: null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  const capability = await resolveVoiceCapability();
  return Response.json(capability, {
    headers: { 'cache-control': 'no-store' },
  });
}
