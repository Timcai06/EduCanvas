import { artifactProposalKindSchema } from '@educanvas/agent-core';
import {
  ArtifactConfirmationNotFoundError,
  ArtifactConfirmationRetryLimitError,
  DrizzleArtifactConfirmationRepository,
  artifactConfirmationMessageId,
} from '@educanvas/db';
import { z } from 'zod';
import { readAnonymousIdentity } from '@/server/identity/anonymous-identity';
import { loadOwnedGeneralRequestConversation } from '@/server/platform/general-request-conversation-context';
import {
  isTrustedSameOriginWrite,
  jsonError,
  jsonResponse,
} from '@/server/http/request-security';
import {
  JsonRequestValidationError,
  readLimitedJsonRequest,
} from '@/server/http/json-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('select'), kind: artifactProposalKindSchema })
    .strict(),
  z.object({ action: z.literal('cancel') }).strict(),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ confirmationId: string }> },
): Promise<Response> {
  if (!isTrustedSameOriginWrite(request))
    return jsonError(403, 'forbidden_origin');
  const identity = await readAnonymousIdentity();
  if (!identity) return jsonError(401, 'unauthorized');
  const conversation = await loadOwnedGeneralRequestConversation(
    identity,
    request,
  );
  if (!conversation) return jsonError(404, 'artifact_confirmation_not_found');
  const { confirmationId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(confirmationId)) {
    return jsonError(404, 'artifact_confirmation_not_found');
  }
  let body: z.infer<typeof actionSchema>;
  try {
    body = actionSchema.parse(
      await readLimitedJsonRequest(request, { maxBytes: 2 * 1024 }),
    );
  } catch (error) {
    if (error instanceof JsonRequestValidationError) {
      return jsonError(
        error.code === 'request_too_large' ? 413 : 400,
        'invalid_request',
      );
    }
    return jsonError(400, 'invalid_request');
  }
  const repository = new DrizzleArtifactConfirmationRepository();
  const scope = {
    actorUserId: identity.studentId,
    notebookId: conversation.spaceId,
    conversationId: conversation.id,
    confirmationId,
  };
  try {
    if (body.action === 'cancel') {
      const result = await repository.cancel(scope);
      return jsonResponse({ status: result.status });
    }
    const result = await repository.updateKind({
      ...scope,
      artifactKind: body.kind,
    });
    return jsonResponse({
      status: result.status,
      kind: result.confirmedKind ?? result.artifactKind,
      clientMessageId: artifactConfirmationMessageId(
        result.id,
        result.attemptNumber,
      ),
    });
  } catch (error) {
    if (error instanceof ArtifactConfirmationRetryLimitError)
      return jsonError(409, 'artifact_confirmation_retry_limit');
    if (error instanceof ArtifactConfirmationNotFoundError) {
      return jsonError(404, 'artifact_confirmation_not_found');
    }
    return jsonError(503, 'artifact_confirmation_unavailable');
  }
}
