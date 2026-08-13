import {
  outputPreferenceSchema,
  type OutputPreference,
} from '@educanvas/agent-core';
import { z } from 'zod';

export const PENDING_GENERAL_TURN_KEY =
  'educanvas.pending-general-turn.v1' as const;

/** 只供一次兼容读取；新代码不得再向这些分裂键写入。 */
export const pendingGeneralTurnLegacyKeys = {
  prompt: 'educanvas.pending-general-prompt.v1',
  menuAction: 'educanvas.pending-general-menu-action.v1',
  canvas: 'educanvas.pending-general-canvas.v1',
  outputPreference: 'educanvas.pending-general-output-preference.v1',
} as const;

export const pendingGeneralTurnReadKeys = [
  PENDING_GENERAL_TURN_KEY,
  pendingGeneralTurnLegacyKeys.prompt,
  pendingGeneralTurnLegacyKeys.menuAction,
  pendingGeneralTurnLegacyKeys.canvas,
  pendingGeneralTurnLegacyKeys.outputPreference,
] as const;

const promptSchema = z
  .string()
  .min(1)
  .max(64_000)
  .refine((value) => value.trim().length > 0, 'prompt不能为空');

export const pendingGeneralTurnSchema = z
  .object({
    prompt: promptSchema,
    outputPreference: outputPreferenceSchema,
  })
  .strict();

export type PendingGeneralTurn = z.infer<typeof pendingGeneralTurnSchema>;

/**
 * 调用方应在同一时刻读取这些值，再交给纯恢复函数；这样 prompt 与 preference
 * 不会跨多个 effect 分别恢复。current 一旦存在即为权威输入，畸形时不回退旧键。
 */
export interface PendingGeneralTurnStorageSnapshot {
  readonly current: string | null;
  readonly legacyPrompt: string | null;
  readonly legacyMenuAction: string | null;
  readonly legacyCanvas: string | null;
  readonly legacyOutputPreference: string | null;
}

export type PendingGeneralTurnRestore =
  | { readonly kind: 'turn'; readonly payload: PendingGeneralTurn }
  | { readonly kind: 'legacy_menu_action'; readonly action: string }
  | { readonly kind: 'none' };

export interface PendingGeneralTurnWrite {
  readonly key: typeof PENDING_GENERAL_TURN_KEY;
  readonly value: string;
}

/** 新入口只生成一个版本化 payload 写入，不产生任何旧键写操作。 */
export function createPendingGeneralTurnWrite(
  input: PendingGeneralTurn,
): PendingGeneralTurnWrite {
  const payload = pendingGeneralTurnSchema.parse(input);
  return {
    key: PENDING_GENERAL_TURN_KEY,
    value: JSON.stringify(payload),
  };
}

function parseCurrent(value: string): PendingGeneralTurn | null {
  try {
    const parsedJson: unknown = JSON.parse(value);
    const parsed = pendingGeneralTurnSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function legacyPreference(
  outputPreference: string | null,
  canvas: string | null,
): OutputPreference {
  const parsed = outputPreferenceSchema.safeParse(outputPreference);
  if (parsed.success) return parsed.data;
  return canvas === null ? 'auto' : 'interactive_artifact';
}

/**
 * 原子恢复一次 Landing 交接。turn 分支把 preference 与 prompt 放在同一个返回值中，
 * controller 必须先设置 preference，再排队发送；本函数不决定发送后的 reset 语义。
 */
export function restorePendingGeneralTurn(
  snapshot: PendingGeneralTurnStorageSnapshot,
): PendingGeneralTurnRestore {
  if (snapshot.current !== null) {
    const payload = parseCurrent(snapshot.current);
    return payload ? { kind: 'turn', payload } : { kind: 'none' };
  }

  if (snapshot.legacyPrompt !== null) {
    const parsedPrompt = promptSchema.safeParse(snapshot.legacyPrompt);
    if (!parsedPrompt.success) return { kind: 'none' };
    return {
      kind: 'turn',
      payload: {
        prompt: parsedPrompt.data,
        outputPreference: legacyPreference(
          snapshot.legacyOutputPreference,
          snapshot.legacyCanvas,
        ),
      },
    };
  }

  const legacyMenuAction = snapshot.legacyMenuAction?.trim();
  return legacyMenuAction
    ? { kind: 'legacy_menu_action', action: legacyMenuAction }
    : { kind: 'none' };
}
