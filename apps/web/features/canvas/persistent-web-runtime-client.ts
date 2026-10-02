import { z } from 'zod';
import type { WebRuntimeFailureCode } from '@educanvas/canvas-protocol';
import {
  notebookScopedFetch,
  type NotebookRequestContext,
} from '@/features/workspace/general/notebook-request-context';
import { runtimeRequestCancelPath } from './persistent-web-runtime-model';

const terminalResponseSchema = z
  .object({
    runId: z.string().uuid(),
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    terminalAuthority: z.literal('client_observed'),
  })
  .strict();
async function writeTerminal(
  runId: string,
  body: { status: 'succeeded' } | { status: 'failed'; failureCode: string },
  context: NotebookRequestContext | null,
): Promise<z.infer<typeof terminalResponseSchema>> {
  const response = await notebookScopedFetch(
    `/api/v1/canvas/runtime/runs/${encodeURIComponent(runId)}/terminal`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    context,
  );
  if (!response.ok) throw new Error('terminal_unavailable');
  return terminalResponseSchema.parse(await response.json());
}

export async function writeCancellation(
  runId: string,
  context: NotebookRequestContext | null,
): Promise<z.infer<typeof terminalResponseSchema>> {
  const response = await notebookScopedFetch(
    `/api/v1/canvas/runtime/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
    },
    context,
  );
  if (!response.ok) throw new Error('cancel_unavailable');
  return terminalResponseSchema.parse(await response.json());
}

export type ObservedTerminal =
  | { status: 'succeeded' }
  | { status: 'failed'; failureCode: WebRuntimeFailureCode }
  | { status: 'cancelled' };

export async function persistObservedTerminal(
  runId: string,
  terminal: ObservedTerminal,
  context: NotebookRequestContext | null,
): Promise<z.infer<typeof terminalResponseSchema>> {
  if (terminal.status === 'cancelled') {
    return writeCancellation(runId, context);
  }
  return writeTerminal(runId, terminal, context);
}

export async function cancelRequest(
  requestId: string,
  context: NotebookRequestContext | null,
): Promise<void> {
  await notebookScopedFetch(
    runtimeRequestCancelPath(requestId),
    {
      method: 'POST',
    },
    context,
  );
}
