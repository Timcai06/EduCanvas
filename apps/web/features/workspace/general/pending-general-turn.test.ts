import { describe, expect, it } from 'vitest';
import {
  PENDING_GENERAL_TURN_KEY,
  createPendingGeneralTurnWrite,
  pendingGeneralTurnLegacyKeys,
  pendingGeneralTurnReadKeys,
  restorePendingGeneralTurn,
  type PendingGeneralTurnStorageSnapshot,
} from './pending-general-turn';

function snapshot(
  overrides: Partial<PendingGeneralTurnStorageSnapshot> = {},
): PendingGeneralTurnStorageSnapshot {
  return {
    current: null,
    legacyPrompt: null,
    legacyMenuAction: null,
    legacyCanvas: null,
    legacyOutputPreference: null,
    ...overrides,
  };
}

describe('createPendingGeneralTurnWrite', () => {
  it('只生成一个新键写入，payload 原子包含 prompt 与 outputPreference', () => {
    const write = createPendingGeneralTurnWrite({
      prompt: '请生成一份函数图像讲义',
      outputPreference: 'markdown_document',
    });

    expect(write).toEqual({
      key: PENDING_GENERAL_TURN_KEY,
      value: JSON.stringify({
        prompt: '请生成一份函数图像讲义',
        outputPreference: 'markdown_document',
      }),
    });
    expect(Object.values(pendingGeneralTurnLegacyKeys)).not.toContain(
      write.key,
    );
  });

  it('拒绝未知 preference、空 prompt 和额外字段', () => {
    expect(() =>
      createPendingGeneralTurnWrite({
        prompt: '讲解函数',
        outputPreference: 'canvas',
      } as never),
    ).toThrow();
    expect(() =>
      createPendingGeneralTurnWrite({
        prompt: '   ',
        outputPreference: 'auto',
      }),
    ).toThrow();
    expect(() =>
      createPendingGeneralTurnWrite({
        prompt: '讲解函数',
        outputPreference: 'auto',
        canvasSelected: true,
      } as never),
    ).toThrow();
  });
});

describe('restorePendingGeneralTurn', () => {
  it('从新 payload 原子返回 preference 与 prompt', () => {
    expect(
      restorePendingGeneralTurn(
        snapshot({
          current: JSON.stringify({
            prompt: '生成互动练习',
            outputPreference: 'interactive_artifact',
          }),
        }),
      ),
    ).toEqual({
      kind: 'turn',
      payload: {
        prompt: '生成互动练习',
        outputPreference: 'interactive_artifact',
      },
    });
  });

  it('新 payload 存在但畸形时 fail closed，不回退陈旧旧键', () => {
    expect(
      restorePendingGeneralTurn(
        snapshot({
          current: '{bad json',
          legacyPrompt: '不应发送',
          legacyOutputPreference: 'web_app',
        }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('兼容旧 prompt 与 output preference，并保持同一返回值', () => {
    expect(
      restorePendingGeneralTurn(
        snapshot({
          legacyPrompt: '生成网页实验',
          legacyOutputPreference: 'web_app',
        }),
      ),
    ).toEqual({
      kind: 'turn',
      payload: {
        prompt: '生成网页实验',
        outputPreference: 'web_app',
      },
    });
  });

  it('旧 preference 无效时兼容 Canvas 键，否则回退 auto', () => {
    expect(
      restorePendingGeneralTurn(
        snapshot({
          legacyPrompt: '生成练习',
          legacyCanvas: '1',
          legacyOutputPreference: 'canvas',
        }),
      ),
    ).toMatchObject({
      kind: 'turn',
      payload: { outputPreference: 'interactive_artifact' },
    });
    expect(
      restorePendingGeneralTurn(snapshot({ legacyPrompt: '解释概念' })),
    ).toMatchObject({
      kind: 'turn',
      payload: { outputPreference: 'auto' },
    });
  });

  it('旧 menu action 没有 prompt 时单独返回兼容输入，不伪造 Turn', () => {
    expect(
      restorePendingGeneralTurn(snapshot({ legacyMenuAction: 'upload_file' })),
    ).toEqual({ kind: 'legacy_menu_action', action: 'upload_file' });
  });

  it('声明新旧五个读取键，供 controller 一次快照并消费', () => {
    expect(pendingGeneralTurnReadKeys).toEqual([
      PENDING_GENERAL_TURN_KEY,
      pendingGeneralTurnLegacyKeys.prompt,
      pendingGeneralTurnLegacyKeys.menuAction,
      pendingGeneralTurnLegacyKeys.canvas,
      pendingGeneralTurnLegacyKeys.outputPreference,
    ]);
  });
});
