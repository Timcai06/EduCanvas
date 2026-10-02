import {
  ArtifactJobLifecycleError,
  type DrizzlePlatformArtifactRepository,
} from '@educanvas/db';
import type { MarkdownLongformCheckpoint } from './markdown-generation-policy.js';
import { reportGenerationProgress } from './generation-progress.js';

export const isExecutionFenceError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 'artifact_execution_fenced';

/** 单个 worker execution 领取的 fence 约束检查点与失败终态写入。 */
export class ArtifactGenerationExecution {
  generation: number | undefined;
  checkpoint: Record<string, unknown> = {};

  constructor(
    private readonly artifacts: DrizzlePlatformArtifactRepository,
    private readonly payload: { jobId: string; subjectId: string },
    private readonly logger: { warn: (message: string) => void },
  ) {}

  async start(kind: string): Promise<void> {
    if (kind === 'markdown_document') {
      const claimed = await this.artifacts.claimGenerationJobExecution({
        jobId: this.payload.jobId,
        trustedSubjectId: this.payload.subjectId,
      });
      this.generation = claimed.executionGeneration;
      this.checkpoint = claimed.checkpoint;
    } else {
      await this.artifacts.transitionGenerationJob({
        jobId: this.payload.jobId,
        trustedSubjectId: this.payload.subjectId,
        to: 'running',
        progress: 5,
      });
    }
  }

  async fail(code: string): Promise<void> {
    try {
      await this.artifacts.transitionGenerationJob({
        jobId: this.payload.jobId,
        trustedSubjectId: this.payload.subjectId,
        to: 'failed',
        failureCode: code,
        executionGeneration: this.generation,
      });
    } catch (error) {
      if (isExecutionFenceError(error)) {
        this.logger.warn(
          `任务 ${this.payload.jobId} execution 已过期，忽略旧失败状态`,
        );
        return;
      }
      if (error instanceof ArtifactJobLifecycleError) {
        this.logger.warn(
          `任务 ${this.payload.jobId} 无法写 failed(${code}),已进入终态 ${error.message}`,
        );
        return;
      }
      throw error;
    }
  }

  async saveMarkdownCheckpoint(
    checkpoint: MarkdownLongformCheckpoint,
  ): Promise<void> {
    await this.artifacts.updateGenerationJobCheckpoint({
      jobId: this.payload.jobId,
      trustedSubjectId: this.payload.subjectId,
      checkpoint,
      executionGeneration: this.generation,
    });
    const completed = checkpoint.completedSections.length;
    const sectionCount = checkpoint.sections.length;
    await reportGenerationProgress(
      this.artifacts,
      this.payload,
      sectionCount === 0
        ? 20
        : Math.min(80, 20 + Math.floor((60 * completed) / sectionCount)),
      this.logger,
    );
  }
}
