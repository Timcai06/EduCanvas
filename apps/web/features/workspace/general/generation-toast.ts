import type { GenerationState } from '@/features/canvas/artifact-generation-flow';

export interface GenerationSettledToastSpec {
  readonly title: string;
  readonly description: string;
  readonly tone: 'success' | 'error';
  readonly actionLabel?: string;
}

/**
 * 生成观察收敛到终态时的 toast 文案判定（纯函数，便于测试）：
 * 修订失败虽然 phase='ready'（旧版本仍可用），但必须报失败而非成功。
 */
export function describeGenerationSettledToast(
  generation: GenerationState,
): GenerationSettledToastSpec | null {
  if (generation.phase !== 'ready' && generation.phase !== 'failed') {
    return null;
  }
  if (generation.phase === 'failed') {
    if (generation.outcome === 'cancelled') return null;
    return {
      title: '产物生成失败',
      description: `《${generation.title}》未能完成`,
      tone: 'error',
    };
  }
  if (generation.revisionOutcome === 'failed') {
    return {
      title: '产物修订失败',
      description: `《${generation.title}》保持原版本`,
      tone: 'error',
    };
  }
  if (
    generation.revisionOutcome !== undefined &&
    generation.revisionOutcome !== 'ready'
  ) {
    /* 本地取消观察（pending）或任务仍在后台（cancelled/timed_out）：不通知。 */
    return null;
  }
  return {
    title: '产物已生成',
    description: `《${generation.title}》已就绪`,
    tone: 'success',
    ...(generation.artifactId ? { actionLabel: '打开' } : {}),
  };
}
