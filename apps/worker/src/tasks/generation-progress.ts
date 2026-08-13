import { ArtifactJobLifecycleError } from '@educanvas/db';

/** 进度上报所需的最小仓储端口；注入的完整仓储天然满足。 */
export interface GenerationJobTransitionPort {
  transitionGenerationJob: (input: {
    jobId: string;
    trustedSubjectId: string;
    to: 'running';
    progress: number;
  }) => Promise<unknown>;
}

/**
 * 阶段进度上报：running→running 更新 progress（仓储层 GREATEST 保证单调）。
 * 状态机拒绝（如重投后已终态）时静默跳过，不阻塞生成主链。
 */
export async function reportGenerationProgress(
  artifacts: GenerationJobTransitionPort,
  job: { jobId: string; subjectId: string },
  progress: number,
  logger: { warn: (message: string) => void },
): Promise<void> {
  try {
    await artifacts.transitionGenerationJob({
      jobId: job.jobId,
      trustedSubjectId: job.subjectId,
      to: 'running',
      progress,
    });
  } catch (error) {
    if (!(error instanceof ArtifactJobLifecycleError)) throw error;
    logger.warn(`任务 ${job.jobId} 无法更新进度 ${progress}，继续生成`);
  }
}
