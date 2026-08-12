import type {
  LiveVoiceTranscriptEntry,
  LiveVoiceVisualPhase,
} from './live-voice-panel';
import type { ChatMessageStatus } from '@/features/chat/messages';

export const LIVE_STATUS = {
  idle: '准备就绪',
  starting: '正在连接…',
  authorizing: '请允许麦克风访问',
  recording: '正在聆听',
  finalizing: '正在整理你的话…',
  stopped: '等待下一轮',
  cancelled: '已静音',
  failed: '连接中断',
} as const;

export function resolveLiveVoiceVisualPhase(input: {
  readonly muted: boolean;
  readonly busy: boolean;
  readonly preparing?: boolean;
  readonly recovering?: boolean;
  readonly speaking: boolean;
  readonly status: keyof typeof LIVE_STATUS;
}): LiveVoiceVisualPhase {
  if (input.muted) return 'muted';
  if (input.recovering) return 'connecting';
  if (input.status === 'failed') return 'error';
  if (input.speaking) return 'speaking';
  if (input.preparing || input.busy) return 'thinking';
  if (input.status === 'starting' || input.status === 'authorizing') {
    return 'connecting';
  }
  if (input.status === 'recording' || input.status === 'finalizing') {
    return 'listening';
  }
  return 'idle';
}

export function mergeDictationTranscript(
  base: string,
  transcript: string,
): string {
  const existing = base.trimEnd();
  const text = transcript.trim();
  if (!text) return base;
  return existing ? `${existing} ${text}` : text;
}

/** 进入 Live 前已有的消息永远不属于本次会话，即使父级滑动窗口淘汰了锚点。 */
export function filterLiveSessionTranscript(
  transcript: readonly LiveVoiceTranscriptEntry[],
  baselineIds: readonly string[],
): readonly LiveVoiceTranscriptEntry[] {
  const baseline = new Set(baselineIds);
  return transcript.filter((entry) => !baseline.has(entry.id));
}

/** 入室前已终态的 Assistant 不得冒充本轮长回答；活跃流可由 Live 接管。 */
export function resolveLiveReaderBaselineId(input: {
  readonly assistantId: string | null;
  readonly status: ChatMessageStatus | null;
}): string | null {
  return input.assistantId &&
    input.status !== 'pending' &&
    input.status !== 'streaming'
    ? input.assistantId
    : null;
}
