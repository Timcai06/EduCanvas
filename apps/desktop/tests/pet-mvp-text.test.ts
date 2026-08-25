import { describe, expect, it, vi } from 'vitest';
import {
  createPetSubmitGate,
  submitPetText,
} from '../src/renderer/src/pet-mvp-text';

describe('桌宠 MVP 文本对话', () => {
  it('复用 P3 assistant turn 并返回同一轮回复', async () => {
    const turn = vi.fn(async () => ({
      ok: true as const,
      action: 'answered' as const,
      message: '你好，我是 EduCanvas 助手。',
    }));

    await expect(
      submitPetText(' 你好 ', 'request:1', turn, 'desktop:cm-1'),
    ).resolves.toEqual({
      ok: true,
      action: 'answered',
      reply: '你好，我是 EduCanvas 助手。',
    });
    expect(turn).toHaveBeenCalledWith(
      '你好',
      'request:1',
      'text',
      'desktop:cm-1',
      undefined,
    );
  });

  it('保留后端明确的答题正确动作，不从回复文字猜测', async () => {
    const turn = vi.fn(async () => ({
      ok: true as const,
      action: 'assessment_correct' as const,
      message: '继续保持。',
    }));

    await expect(submitPetText('42', 'request:correct', turn)).resolves.toEqual(
      {
        ok: true,
        action: 'assessment_correct',
        reply: '继续保持。',
      },
    );
  });

  it('拒绝空文本，不创建隐藏 Turn', async () => {
    const turn = vi.fn();
    await expect(submitPetText('   ', 'request:2', turn)).resolves.toEqual({
      ok: false,
      code: 'invalid_input',
      error: '请输入内容。',
    });
    expect(turn).not.toHaveBeenCalled();
  });

  it('纯附件（空文字）也允许发送，并透传附件到 turn（DP10）', async () => {
    const turn = vi.fn(async () => ({
      ok: true as const,
      action: 'answered' as const,
      message: '看到了。',
    }));
    const attachment = {
      assetId: 'asset:one',
      versionId: 'version:one',
      kind: 'image' as const,
      mimeType: 'image/png',
      displayName: '截图.png',
      notebookId: 'notebook:1',
    };
    await expect(
      submitPetText('', 'request:4', turn, 'desktop:cm-4', attachment),
    ).resolves.toEqual({ ok: true, action: 'answered', reply: '看到了。' });
    expect(turn).toHaveBeenCalledWith(
      '',
      'request:4',
      'text',
      'desktop:cm-4',
      attachment,
    );
  });

  it('保留后端失败类型，供桌宠选择正确错误动作', async () => {
    const turn = vi.fn(async () => ({
      ok: false as const,
      code: 'backend_offline' as const,
      message: '服务未启动。',
    }));

    await expect(submitPetText('你好', 'request:3', turn)).resolves.toEqual({
      ok: false,
      code: 'backend_offline',
      error: '服务未启动。',
    });
  });

  it('IPC 调用异常时返回可恢复错误，不让界面停在回复中', async () => {
    const turn = vi.fn(async () => {
      throw new Error('Invalid assistant turn');
    });

    await expect(
      submitPetText('你好', 'request:ipc-failure', turn),
    ).resolves.toEqual({
      ok: false,
      code: 'backend_offline',
      error: '暂时无法连接 EduCanvas，请稍后重试。',
    });
  });

  it('prevents a second submit until the active operation leaves', () => {
    const gate = createPetSubmitGate();
    const first = gate.enter();

    expect(first).not.toBeNull();
    expect(gate.enter()).toBeNull();
    gate.leave(first!);
    expect(gate.enter()).not.toBeNull();
  });
});
