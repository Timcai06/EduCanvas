/**
 * Live Voice 出室带回：把一次语音会话的痕迹装订成可落库的本地 payload。
 *
 * 纪律：退场时间线不依赖网络——payload 在 EXIT 瞬间同步组装（数据今天已经
 * 全部在客户端：baseline 过滤后的会话转录），写库与退场动画并行，失败只影响
 * 持久化、不影响归位动画。
 *
 * M1 只交付信笺（转录装订，不调 LLM——是装订不是摘要）；annotations 与
 * touchedArtifactIds 的填充属于 M2+，字段先冻结形状。
 */
import type { LiveVoiceTranscriptEntry } from './live-voice-panel';
import type {
  CanvasAnnotationGeometry,
  CanvasResourceKind,
} from '@educanvas/canvas-protocol';

export interface LiveVoiceAnnotationDraft {
  readonly clientId: string;
  readonly resourceKind: CanvasResourceKind;
  readonly resourceId: string;
  readonly resourceVersionId: string | null;
  readonly kind: 'circle';
  readonly geometry: CanvasAnnotationGeometry;
}

export interface LiveVoiceExitPayload {
  readonly endedAt: number;
  /** 本次 Live 会话内产生的对话（进入前已有的消息已被 baseline 排除）。 */
  readonly sessionTranscript: readonly LiveVoiceTranscriptEntry[];
  /** Voice 中圈下的朱砂痕迹；由工作区在出室时并行持久化。 */
  readonly annotations: readonly LiveVoiceAnnotationDraft[];
  /** 会话中打开/生成的产物；M1 恒为空，占位给产物归位。 */
  readonly touchedArtifactIds: readonly string[];
}

/**
 * 组装出室 payload。输入的 sessionTranscript 必须已过滤 baseline（composer 侧
 * filterLiveSessionTranscript 的产物）。会话没有任何新内容时返回 null——
 * 空会话不留痕，调用方据此跳过信笺写库。
 */
export function assembleLiveVoiceExitPayload(input: {
  readonly sessionTranscript: readonly LiveVoiceTranscriptEntry[];
  readonly touchedArtifactIds?: readonly string[];
  readonly annotations?: readonly LiveVoiceAnnotationDraft[];
  readonly now?: number;
}): LiveVoiceExitPayload | null {
  const sessionTranscript = input.sessionTranscript.filter(
    (entry) => entry.text.trim().length > 0,
  );
  const touchedArtifactIds = input.touchedArtifactIds ?? [];
  const annotations = input.annotations ?? [];
  if (
    sessionTranscript.length === 0 &&
    touchedArtifactIds.length === 0 &&
    annotations.length === 0
  ) {
    return null;
  }
  return {
    endedAt: input.now ?? Date.now(),
    sessionTranscript,
    annotations,
    touchedArtifactIds,
  };
}

/**
 * 信笺正文：转录的朴素装订。说话人标签沿用现有语义（你 / AI），
 * 段落间空行，交给 note artifact 的 markdown 渲染。
 */
export function formatLiveVoiceLetterMarkdown(
  transcript: readonly LiveVoiceTranscriptEntry[],
  endedAt: number,
): string {
  const date = new Date(endedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const body = transcript
    .map((entry) => `**${entry.speaker}**：${entry.text.trim()}`)
    .join('\n\n');
  return `## Live Voice 会话 · ${stamp}\n\n${body}\n`;
}
