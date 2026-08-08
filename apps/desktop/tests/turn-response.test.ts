import { describe, expect, it } from 'vitest';
import { turnResultToBubble } from '../src/renderer/src/turn-response';
import type { TurnResult } from '../src/shared/turn-result';

describe('turnResultToBubble', () => {
  it('成功 → completed + message', () => {
    const r: TurnResult = {
      ok: true,
      action: 'created',
      message: '已创建笔记本「物理」',
    };
    expect(turnResultToBubble(r)).toEqual({
      text: '已创建笔记本「物理」',
      status: 'completed',
    });
  });

  it('backend_offline → 服务未启动指引', () => {
    const r: TurnResult = {
      ok: false,
      code: 'backend_offline',
      message: '本地服务未启动（先 pnpm dev:all）。',
    };
    expect(turnResultToBubble(r)).toEqual({
      text: '本地服务未启动（先 pnpm dev:all）。',
      status: 'failed',
    });
  });

  it('aborted → 不产生失败气泡（静默）', () => {
    const r: TurnResult = { ok: false, code: 'aborted', message: '已取消。' };
    expect(turnResultToBubble(r)).toBeNull();
  });
});
