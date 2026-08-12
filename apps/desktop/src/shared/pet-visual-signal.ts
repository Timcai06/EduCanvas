export type PetVisualSignal =
  | 'ready'
  | 'authorizing'
  | 'greeting'
  | 'listening'
  | 'sending'
  | 'speaking'
  | 'celebrating'
  | 'auth-failed'
  | 'backend-failed'
  | 'confused';

export const PET_VISUAL_SIGNALS: readonly PetVisualSignal[] = [
  'ready',
  'authorizing',
  'greeting',
  'listening',
  'sending',
  'speaking',
  'celebrating',
  'auth-failed',
  'backend-failed',
  'confused',
];

export function isPetVisualSignal(value: unknown): value is PetVisualSignal {
  return typeof value === 'string' && PET_VISUAL_SIGNALS.includes(value as PetVisualSignal);
}
