import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { readExperienceMode } from '@/server/experience-mode';
import { resolveDictationGateway } from '@/server/voice/dictation-gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const [identity, mode] = await Promise.all([
    readAnonymousIdentity(),
    readExperienceMode(),
  ]);
  const result =
    !identity || identity.studentId.startsWith('anon:v1:')
      ? { enabled: false, reason: 'login_required' }
      : mode === null
        ? { enabled: false, reason: 'experience_mode_required' }
        : resolveDictationGateway() === null
          ? { enabled: false, reason: 'transcription_unavailable' }
          : { enabled: true, reason: null };
  return Response.json(result, {
    headers: { 'cache-control': 'private, no-store' },
  });
}
