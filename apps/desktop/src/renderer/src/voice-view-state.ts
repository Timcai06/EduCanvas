import type { PetUiState } from './pet-visual-state';
import type { VoiceSessionSnapshot } from './voice-session';
import type { DesktopChatHistorySnapshot } from '../../shared/chat-history';

export function latestAssistantReply(
  history: DesktopChatHistorySnapshot,
): string {
  return (
    history.messages.findLast(({ role }) => role === 'assistant')?.content ?? ''
  );
}

export function isBusyState(state: PetUiState): boolean {
  return ['authorizing', 'listening', 'sending', 'speaking'].includes(state);
}

export function voiceSnapshotState(snapshot: VoiceSessionSnapshot): PetUiState {
  if (snapshot.phase === 'starting' || snapshot.phase === 'listening')
    return 'listening';
  if (snapshot.phase === 'transcribing' || snapshot.phase === 'thinking')
    return 'sending';
  if (snapshot.phase === 'speaking') return 'speaking';
  if (snapshot.phase === 'error') {
    if (snapshot.error?.includes('登录')) return 'auth-failed';
    if (snapshot.error?.includes('服务') || snapshot.error?.includes('连接'))
      return 'backend-failed';
    return 'confused';
  }
  return 'ready';
}
