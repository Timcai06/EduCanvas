import 'server-only';
import { z } from 'zod';
import { TurnRequestValidationError } from '../http/turn-request';

/** Explicit first-party navigation scope is untrusted input; it must never fall back to Cookie. */
export function readTeachingRequestScope(
  request: Request,
): { notebookId: string; conversationId?: string } | undefined {
  const parameters = new URL(request.url).searchParams;
  if (
    !parameters.has('requestNotebookId') &&
    !parameters.has('requestConversationId')
  )
    return undefined;
  const notebookId = parameters.get('requestNotebookId');
  const conversationId = parameters.get('requestConversationId');
  if (
    !z.string().uuid().safeParse(notebookId).success ||
    (conversationId !== null &&
      !z.string().uuid().safeParse(conversationId).success) ||
    parameters.getAll('requestNotebookId').length !== 1 ||
    parameters.getAll('requestConversationId').length > 1
  )
    throw new TurnRequestValidationError('invalid_request');
  return {
    notebookId: notebookId!,
    ...(conversationId ? { conversationId } : {}),
  };
}
