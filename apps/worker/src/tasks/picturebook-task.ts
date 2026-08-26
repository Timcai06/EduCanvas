import type {
  DrizzlePlatformArtifactRepository,
  PlatformArtifact,
  PlatformArtifactJob,
} from '@educanvas/db';
import type { WorkerModelRuntime } from '../model-runtime.js';
import { reportGenerationProgress } from './generation-progress.js';
import { resolveArtifactGenerationIntent } from './artifact-generation-intent.js';
import { appendPicturebookVersion } from './picturebook-generation.js';

interface PicturebookTurnReader {
  listMessages(input: {
    conversationId: string;
    trustedSubjectId: string;
    limit: number;
  }): Promise<
    readonly {
      role: string;
      content: string;
    }[]
  >;
}

/** generate-artifact 的绘本分支组合；主任务只负责 kind 路由。 */
export async function runPicturebookGenerationTask(input: {
  artifact: PlatformArtifact;
  job: PlatformArtifactJob;
  subjectId: string;
  artifacts: DrizzlePlatformArtifactRepository;
  turns: PicturebookTurnReader;
  getRuntime: () => WorkerModelRuntime;
  logger: { warn: (message: string) => void };
}) {
  const intent = resolveArtifactGenerationIntent(input.job.params);
  if (intent.kind !== 'initial' || !input.artifact.conversationId) return null;
  const messages = await input.turns.listMessages({
    conversationId: input.artifact.conversationId,
    trustedSubjectId: input.subjectId,
    limit: 40,
  });
  const runtime = input.getRuntime();
  return appendPicturebookVersion({
    artifact: input.artifact,
    job: input.job,
    subjectId: input.subjectId,
    artifacts: input.artifacts,
    structuredGateway: runtime.structured,
    imageGateway: runtime.image,
    messages: messages.map((message) => ({
      role:
        message.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: message.content,
    })),
    instruction: intent.instruction,
    reportProgress: (progress) =>
      reportGenerationProgress(
        input.artifacts,
        { jobId: input.job.id, subjectId: input.subjectId },
        progress,
        input.logger,
      ),
  });
}
