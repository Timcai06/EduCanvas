import type { DesktopAttachmentRef } from '../shared/desktop-attachment';

export interface DesktopAssistantTurnInput {
  requestId: string;
  text: string;
  source?: 'text' | 'voice';
  clientMessageId?: string;
  leaseToken: string;
  attachment?: DesktopAttachmentRef;
}

/** Renderer boundary validation for the constrained DP10 attachment projection. */
export function isDesktopAttachmentRef(
  value: unknown,
): value is DesktopAttachmentRef {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.assetId === 'string' &&
    record.assetId.length > 0 &&
    record.assetId.length <= 160 &&
    typeof record.versionId === 'string' &&
    record.versionId.length > 0 &&
    record.versionId.length <= 160 &&
    typeof record.kind === 'string' &&
    record.kind.length > 0 &&
    record.kind.length <= 64 &&
    typeof record.mimeType === 'string' &&
    record.mimeType.length > 0 &&
    record.mimeType.length <= 255 &&
    typeof record.displayName === 'string' &&
    record.displayName.length > 0 &&
    record.displayName.length <= 300 &&
    typeof record.notebookId === 'string' &&
    record.notebookId.length > 0 &&
    record.notebookId.length <= 160
  );
}

/**
 * Validates untrusted assistant-turn IPC input without relying on Electron state.
 * Lease ownership is checked separately by the main process because it depends on
 * the sender id that Electron supplies for the current IPC event.
 */
export function isDesktopAssistantTurnInput(
  value: unknown,
): value is DesktopAssistantTurnInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return (
    typeof input.requestId === 'string' &&
    input.requestId.length > 0 &&
    input.requestId.length <= 200 &&
    typeof input.leaseToken === 'string' &&
    input.leaseToken.length > 0 &&
    input.leaseToken.length <= 200 &&
    typeof input.text === 'string' &&
    input.text.length <= 4_000 &&
    (input.source === undefined ||
      ['text', 'voice'].includes(input.source as string)) &&
    (input.clientMessageId === undefined ||
      (typeof input.clientMessageId === 'string' &&
        input.clientMessageId.length > 0 &&
        input.clientMessageId.length <= 200)) &&
    (input.attachment === undefined || isDesktopAttachmentRef(input.attachment))
  );
}
