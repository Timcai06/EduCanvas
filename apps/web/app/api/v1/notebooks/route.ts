import { DrizzlePlatformConversationRepository } from '@educanvas/db';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { jsonResponse } from '@/server/http/request-security';
export const dynamic = 'force-dynamic';
export async function GET() {
  const identity = await readAnonymousIdentity();
  return jsonResponse({
    notebooks: identity
      ? await new DrizzlePlatformConversationRepository().listNotebooks({
          trustedSubjectId: identity.studentId,
        })
      : [],
  });
}
