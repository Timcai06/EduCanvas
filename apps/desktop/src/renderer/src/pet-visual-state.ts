import type { PetTextFailureCode } from './pet-mvp-text';
import type { DesktopAuthStatus } from '../../shared/desktop-auth';
import type { PetVisualSignal } from '../../shared/pet-visual-signal';

export type PetUiState = PetVisualSignal;

export type PetVisual =
  | 'idle'
  | 'greeting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'celebrating'
  | 'login-failed'
  | 'backend-offline'
  | 'confused';

export function petVisualForState(state: PetUiState): PetVisual {
  switch (state) {
    case 'greeting':
      return 'greeting';
    case 'listening':
      return 'listening';
    case 'sending':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'celebrating':
      return 'celebrating';
    case 'auth-failed':
      return 'login-failed';
    case 'backend-failed':
      return 'backend-offline';
    case 'confused':
      return 'confused';
    default:
      return 'idle';
  }
}

export function petUiStateForTurnAction(action: string): PetUiState {
  return action === 'assessment_correct' ? 'celebrating' : 'ready';
}

type AuthState = DesktopAuthStatus['state'];

export function petUiStateForAuthTransition(
  previous: AuthState | null,
  next: AuthState,
): PetUiState | null {
  return previous === 'authorizing' && next === 'signed_in'
    ? 'celebrating'
    : null;
}

export function petTransientResetDelay(state: PetUiState): number | null {
  return [
    'greeting',
    'sending',
    'celebrating',
    'auth-failed',
    'backend-failed',
    'confused',
  ].includes(state)
    ? 3_000
    : null;
}

export function petUiStateForFailureCode(code: PetTextFailureCode): PetUiState {
  if (code === 'invalid_input') return 'confused';
  if (code === 'unauthenticated') return 'auth-failed';
  if (code === 'aborted') return 'ready';
  return 'backend-failed';
}
