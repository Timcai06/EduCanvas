import { describe, expect, it } from 'vitest';
import {
  isDesktopAssistantTurnInput,
  isDesktopAttachmentRef,
} from '../src/main/assistant-turn-input';

const attachment = {
  assetId: 'asset:one',
  versionId: 'version:one',
  kind: 'image',
  mimeType: 'image/png',
  displayName: '截图.png',
  notebookId: 'notebook:one',
};

describe('assistant turn IPC input', () => {
  it('accepts a normal text turn without an attachment', () => {
    expect(
      isDesktopAssistantTurnInput({
        requestId: 'request:one',
        leaseToken: 'lease:one',
        text: '你好',
        source: 'text',
        clientMessageId: 'desktop:one',
      }),
    ).toBe(true);
  });

  it('accepts an attachment-only turn with a constrained attachment', () => {
    expect(
      isDesktopAssistantTurnInput({
        requestId: 'request:two',
        leaseToken: 'lease:two',
        text: '',
        attachment,
      }),
    ).toBe(true);
  });

  it('rejects malformed request ids and partial attachments', () => {
    expect(
      isDesktopAssistantTurnInput({ leaseToken: 'lease', text: '你好' }),
    ).toBe(false);
    expect(isDesktopAttachmentRef({ ...attachment, assetId: '' })).toBe(false);
    expect(
      isDesktopAssistantTurnInput({
        requestId: 'request:three',
        leaseToken: 'lease:three',
        text: '你好',
        attachment: { ...attachment, displayName: '' },
      }),
    ).toBe(false);
  });
});
