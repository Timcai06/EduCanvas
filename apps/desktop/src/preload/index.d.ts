import type { TurnResult } from '../shared/turn-result';

declare global {
  interface Window {
    desktopAssistant: {
      turn(text: string, signal?: AbortSignal): Promise<TurnResult>;
      onToast(callback: (message: string) => void): () => void;
    };
  }
}
export {};
