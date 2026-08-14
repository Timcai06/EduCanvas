import type { TurnResult } from '../../shared/turn-result';

type TurnFailureCode = Extract<TurnResult, { ok: false }>['code'];
export type PetTextFailureCode = TurnFailureCode | 'invalid_input';

export type PetTextSubmitResult =
  | { ok: true; action: string; reply: string }
  | {
      ok: false;
      code: PetTextFailureCode;
      error: string;
    };

export function createPetSubmitGate() {
  let active: symbol | null = null;
  return {
    enter(): symbol | null {
      if (active) return null;
      active = Symbol('pet-submit');
      return active;
    },
    leave(token: symbol): void {
      if (active === token) active = null;
    },
    cancel(): void {
      active = null;
    },
  };
}

export async function submitPetText(
  rawText: string,
  requestId: string,
  turn: (
    text: string,
    requestId: string,
    source?: 'text' | 'voice',
    clientMessageId?: string,
  ) => Promise<TurnResult>,
  clientMessageId?: string,
): Promise<PetTextSubmitResult> {
  const text = rawText.trim();
  if (!text) return { ok: false, code: 'invalid_input', error: '请输入内容。' };
  const result = await turn(text, requestId, 'text', clientMessageId);
  return result.ok
    ? { ok: true, action: result.action, reply: result.message }
    : { ok: false, code: result.code, error: result.message };
}
