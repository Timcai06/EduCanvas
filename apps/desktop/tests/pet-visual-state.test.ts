import { describe, expect, it } from 'vitest';

import {
  petTransientResetDelay,
  petUiStateForAuthTransition,
  petUiStateForFailureCode,
  petUiStateForTurnAction,
  petVisualForState,
} from '../src/renderer/src/pet-visual-state';

describe('desktop pet visual state', () => {
  it('maps each conversation outcome to its dedicated user-provided animation', () => {
    expect(petVisualForState('sending')).toBe('thinking');
    expect(petVisualForState('listening')).toBe('listening');
    expect(petVisualForState('speaking')).toBe('speaking');
    expect(petVisualForState('greeting')).toBe('greeting');
    expect(petVisualForState('ready')).toBe('idle');
    expect(petVisualForState('celebrating')).toBe('celebrating');
    expect(petVisualForState('auth-failed')).toBe('login-failed');
    expect(petVisualForState('backend-failed')).toBe('backend-offline');
    expect(petVisualForState('confused')).toBe('confused');
  });

  it('does not celebrate an ordinary successful chat reply', () => {
    expect(petUiStateForTurnAction('answered')).toBe('ready');
    expect(petUiStateForTurnAction('assessment_correct')).toBe('celebrating');
  });

  it('celebrates only a completed interactive login, not a restored session', () => {
    expect(petUiStateForAuthTransition(null, 'signed_in')).toBeNull();
    expect(petUiStateForAuthTransition('signed_out', 'signed_in')).toBeNull();
    expect(petUiStateForAuthTransition('authorizing', 'signed_in')).toBe(
      'celebrating',
    );
  });

  it('returns greeting and celebration to idle after a short presentation', () => {
    expect(petTransientResetDelay('greeting')).toBe(3_000);
    expect(petTransientResetDelay('sending')).toBe(3_000);
    expect(petTransientResetDelay('celebrating')).toBe(3_000);
    expect(petTransientResetDelay('confused')).toBe(3_000);
    expect(petTransientResetDelay('auth-failed')).toBe(3_000);
    expect(petTransientResetDelay('backend-failed')).toBe(3_000);
    expect(petTransientResetDelay('listening')).toBeNull();
    expect(petTransientResetDelay('speaking')).toBeNull();
    expect(petTransientResetDelay('ready')).toBeNull();
  });

  it('distinguishes input, authentication, and backend failures', () => {
    expect(petUiStateForFailureCode('invalid_input')).toBe('confused');
    expect(petUiStateForFailureCode('unauthenticated')).toBe('auth-failed');
    expect(petUiStateForFailureCode('backend_offline')).toBe('backend-failed');
    expect(petUiStateForFailureCode('timeout')).toBe('backend-failed');
    expect(petUiStateForFailureCode('http')).toBe('backend-failed');
    expect(petUiStateForFailureCode('aborted')).toBe('ready');
  });
});
