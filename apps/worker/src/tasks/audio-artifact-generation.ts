import {
  assetVersionReferenceSchema,
  ModelGatewayInvocationError,
  ObjectStorageError,
} from '@educanvas/agent-core';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import { audioOverviewMetadataSchema } from '@educanvas/canvas-protocol';
import {
  AssetAccessError,
  DrizzleAssetRepository,
  type DrizzlePlatformArtifactRepository,
  type PlatformArtifact,
  type PlatformArtifactJob,
} from '@educanvas/db';
import { z } from 'zod';
import type { WorkerModelRuntime } from '../model-runtime.js';
import { generateAudioOverviewScript } from './audio-overview-generation.js';

const audioJobParamsSchema = z
  .object({
    selectedSources: z.array(assetVersionReferenceSchema).min(1).max(8),
  })
  .strict();

const audioCheckpointSchema = z
  .object({
    kind: z.literal('audio_overview'),
    objectKey: z.string().min(1).max(1_024),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    metadata: audioOverviewMetadataSchema,
  })
  .strict();

const AUDIO_GENERATOR = 'model:speech.generate:audio-overview-v1';

export class AudioArtifactGenerationFailure extends Error {
  constructor(
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'AudioArtifactGenerationFailure';
  }
}

export async function appendAudioOverviewVersion(input: {
  artifact: PlatformArtifact;
  job: PlatformArtifactJob;
  subjectId: string;
  artifacts: DrizzlePlatformArtifactRepository;
  runtime: WorkerModelRuntime;
}) {
  const storage = new LocalObjectStorage();
  if (Object.keys(input.job.checkpoint).length > 0) {
    const checkpoint = audioCheckpointSchema.safeParse(input.job.checkpoint);
    if (!checkpoint.success) {
      throw new AudioArtifactGenerationFailure('audio_checkpoint_invalid');
    }
    try {
      await storage.readVerified(
        checkpoint.data.objectKey,
        checkpoint.data.checksum,
      );
    } catch (error) {
      throw new AudioArtifactGenerationFailure('audio_checkpoint_invalid', {
        cause: error,
      });
    }
    return input.artifacts.appendVersionAndCompleteGenerationJob({
      jobId: input.job.id,
      artifactId: input.artifact.id,
      trustedSubjectId: input.subjectId,
      objectKey: checkpoint.data.objectKey,
      checksum: checkpoint.data.checksum,
      metadata: checkpoint.data.metadata,
      generatedBy: AUDIO_GENERATOR,
      createdByOperationId: input.job.operationId,
    });
  }

  const params = audioJobParamsSchema.safeParse(input.job.params);
  if (!params.success) {
    throw new AudioArtifactGenerationFailure('audio_sources_invalid');
  }
  let materialized;
  try {
    materialized =
      await new DrizzleAssetRepository().materializeOwnedReferences({
        ownerSubjectId: input.subjectId,
        spaceId: input.artifact.spaceId,
        references: params.data.selectedSources,
      });
  } catch (error) {
    if (error instanceof AssetAccessError) {
      throw new AudioArtifactGenerationFailure('audio_sources_unavailable', {
        cause: error,
      });
    }
    throw error;
  }
  if (
    materialized.some(
      (source) => !source.extractedText || !source.extractedText.trim(),
    )
  ) {
    throw new AudioArtifactGenerationFailure('audio_source_text_missing');
  }

  const speechGateway = input.runtime.speech;
  if (!speechGateway) {
    throw new AudioArtifactGenerationFailure('speech_not_configured');
  }
  const scriptResult = await generateAudioOverviewScript({
    title: input.artifact.title,
    sources: materialized.map((source) => ({
      displayName: source.displayName,
      content: source.extractedText!,
    })),
    gateway: input.runtime.structured,
    traceId: `artifact:${input.artifact.id}:script`,
    operationId: input.job.id,
  });

  let synthesized;
  try {
    synthesized = await speechGateway.generateSpeech({
      taskAlias: 'speech.generate',
      modelAlias: 'speech',
      input: scriptResult.script,
      format: 'mp3',
      promptVersion: 'artifact-audio-overview-speech-v1',
      traceId: `artifact:${input.artifact.id}:speech`,
      operationId: input.job.id,
    });
  } catch (error) {
    if (error instanceof ModelGatewayInvocationError) {
      throw new AudioArtifactGenerationFailure(
        `speech_${error.normalized.code}`,
        { cause: error },
      );
    }
    throw error;
  }

  const objectKey = `artifacts/${input.artifact.id}/jobs/${input.job.id}/overview.mp3`;
  let stored;
  try {
    stored = await storage.put({
      key: objectKey,
      bytes: synthesized.bytes,
      contentType: synthesized.contentType,
    });
  } catch (error) {
    if (error instanceof ObjectStorageError) {
      throw new AudioArtifactGenerationFailure(`storage_${error.code}`, {
        cause: error,
      });
    }
    throw error;
  }
  const metadata = audioOverviewMetadataSchema.parse({
    contentVersion: 1,
    contentType: synthesized.contentType,
    byteSize: stored.sizeBytes,
    transcript: scriptResult.script,
    sourceCount: materialized.length,
    script: scriptResult.audit,
    speech: {
      provider: synthesized.metadata.provider,
      resolvedModelId: synthesized.metadata.resolvedModelId,
      voice: synthesized.voice,
      inputCharacters: synthesized.inputCharacters,
      latencyMs: synthesized.metadata.latencyMs,
    },
  });
  const checkpoint = audioCheckpointSchema.parse({
    kind: 'audio_overview',
    objectKey: stored.key,
    checksum: stored.checksum,
    metadata,
  });
  try {
    await input.artifacts.updateGenerationJobCheckpoint({
      jobId: input.job.id,
      trustedSubjectId: input.subjectId,
      checkpoint,
    });
  } catch (error) {
    await storage.delete(stored.key).catch(() => undefined);
    throw error;
  }
  return input.artifacts.appendVersionAndCompleteGenerationJob({
    jobId: input.job.id,
    artifactId: input.artifact.id,
    trustedSubjectId: input.subjectId,
    objectKey: stored.key,
    checksum: stored.checksum,
    metadata,
    generatedBy: AUDIO_GENERATOR,
    createdByOperationId: input.job.operationId,
  });
}
