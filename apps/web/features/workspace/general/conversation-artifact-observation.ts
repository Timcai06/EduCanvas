import type { GenerationState } from '@/features/canvas/artifact-generation-flow';
import type { MessageArtifactDTO } from '@/features/chat/messages';

/** 同一轮询事实更新聊天卡片；网络失败或本地停止观察不能冒充后台任务失败。 */
export function projectObservedConversationArtifact(
  generation: GenerationState | null,
): MessageArtifactDTO | null {
  const detail = generation?.detail;
  if (!detail || !generation) return null;
  if (generation.outcome === 'pending' || generation.outcome === 'timed_out') {
    return null;
  }
  const artifact = detail.artifact;
  const failed = detail.latestJob?.status === 'failed';
  const cancelled = detail.latestJob?.status === 'cancelled';
  if (artifact.latestVersion === 0 && !failed && !cancelled) return null;
  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    latestVersion: artifact.latestVersion,
    status:
      artifact.latestVersion > 0
        ? artifact.status === 'archived'
          ? 'archived'
          : 'active'
        : cancelled
          ? 'cancelled'
          : 'failed',
  };
}
