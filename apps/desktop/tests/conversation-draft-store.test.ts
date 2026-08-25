import { describe, expect, it } from 'vitest';
import { createConversationDraftStore } from '../src/renderer/src/pet-composer-state';

const attachment = {
  assetId: 'asset:one',
  versionId: 'version:one',
  kind: 'image' as const,
  mimeType: 'image/png',
  displayName: '函数图像.png',
  notebookId: 'notebook:one',
};

describe('desktop conversation drafts', () => {
  it('keeps text and attachments scoped to their conversation', () => {
    const drafts = createConversationDraftStore();
    drafts.save('conversation:one', { text: '第一份草稿', attachment });
    drafts.save('conversation:two', { text: '第二份草稿', attachment: null });

    expect(drafts.load('conversation:one', 'notebook:one')).toEqual({
      text: '第一份草稿',
      attachment,
    });
    expect(drafts.load('conversation:two', 'notebook:one')).toEqual({
      text: '第二份草稿',
      attachment: null,
    });
  });

  it('fails closed when a saved attachment does not belong to the notebook', () => {
    const drafts = createConversationDraftStore();
    drafts.save('conversation:one', { text: '保留文字', attachment });

    expect(drafts.load('conversation:one', 'notebook:two')).toEqual({
      text: '保留文字',
      attachment: null,
    });
  });
});
