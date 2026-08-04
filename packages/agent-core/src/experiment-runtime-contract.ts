/**
 * Experiment runtime data contract.
 *
 * This module owns immutable Run input, bounded output, and terminal evidence
 * shapes. `experiment-runtime-port.ts` owns only the streaming Port boundary.
 */

import { z } from 'zod';

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonEmptyTrimmed = z.string().min(1).max(256);

/**
 * Each input is an immutable Artifact Version mounted read-only under a
 * relative sandbox name. Host paths and traversal are never part of the Port.
 */
export const experimentInputMountSchema = z
  .object({
    mountName: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    artifactId: opaqueIdSchema,
    artifactVersionId: opaqueIdSchema,
    mimeType: z.string().min(1).max(255),
    checksum: sha256Schema,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(500 * 1024 * 1024),
    label: z.string().min(1).max(200).optional(),
  })
  .strict();
export type ExperimentInputMount = z.infer<typeof experimentInputMountSchema>;

/**
 * A dependency must use a complete, exact semantic version. Tags, ranges and
 * URLs would make a supposedly reproducible fixed environment mutable.
 */
const exactSemverPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const experimentDependencySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    version: z
      .string()
      .max(64)
      .regex(exactSemverPattern, 'Dependency version must be exact SemVer'),
  })
  .strict();
export type ExperimentDependency = z.infer<typeof experimentDependencySchema>;

/** Absolute platform upper bounds that an adapter may tighten but never exceed. */
export const MAX_EXPERIMENT_DURATION_MS = 10 * 60_000;
export const MAX_EXPERIMENT_MEMORY_MIB = 2 * 1024;
export const MAX_EXPERIMENT_PROCESSES = 256;
export const MAX_EXPERIMENT_STDOUT_BYTES = 4 * 1024 * 1024;
export const MAX_EXPERIMENT_LOG_BYTES = 8 * 1024 * 1024;
export const MAX_EXPERIMENT_OUTPUT_BYTES = 50 * 1024 * 1024;
export const MAX_EXPERIMENT_OUTPUT_FILES = 128;

export const experimentResourceBudgetSchema = z
  .object({
    maxDurationMs: z.number().int().positive().max(MAX_EXPERIMENT_DURATION_MS),
    maxMemoryMiB: z.number().int().positive().max(MAX_EXPERIMENT_MEMORY_MIB),
    maxProcesses: z.number().int().positive().max(MAX_EXPERIMENT_PROCESSES),
    maxStdoutBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_EXPERIMENT_STDOUT_BYTES),
    maxLogBytes: z.number().int().positive().max(MAX_EXPERIMENT_LOG_BYTES),
    maxOutputBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_EXPERIMENT_OUTPUT_BYTES),
    maxOutputFiles: z
      .number()
      .int()
      .positive()
      .max(MAX_EXPERIMENT_OUTPUT_FILES),
  })
  .strict();
export type ExperimentResourceBudget = z.infer<
  typeof experimentResourceBudgetSchema
>;

/** A bounded Artifact Version reference; raw bytes, keys and host paths stay internal. */
export const experimentOutputArtifactSchema = z
  .object({
    artifactId: opaqueIdSchema,
    artifactVersionId: opaqueIdSchema,
    kind: z.string().min(1).max(64),
    mimeType: z.string().min(1).max(255),
    checksum: sha256Schema,
    byteSize: z.number().int().nonnegative().max(MAX_EXPERIMENT_OUTPUT_BYTES),
  })
  .strict();
export type ExperimentOutputArtifact = z.infer<
  typeof experimentOutputArtifactSchema
>;

/** A log stays inline and short, or refers to an Artifact smaller than the log budget. */
export const experimentLogEntrySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text'),
      content: z.string().max(4096),
    })
    .strict(),
  z
    .object({
      kind: z.literal('artifact_ref'),
      artifactId: opaqueIdSchema,
      artifactVersionId: opaqueIdSchema,
      mimeType: z.string().min(1).max(255),
      checksum: sha256Schema,
      byteSize: z.number().int().nonnegative().max(MAX_EXPERIMENT_LOG_BYTES),
    })
    .strict(),
]);
export type ExperimentLogEntry = z.infer<typeof experimentLogEntrySchema>;

export const experimentRunStatuses = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export const experimentRunStatusSchema = z.enum(experimentRunStatuses);
export type ExperimentRunStatus = z.infer<typeof experimentRunStatusSchema>;

export const experimentRunTerminalStatuses = [
  'succeeded',
  'failed',
  'cancelled',
] as const;
export const experimentRunTerminalStatusSchema = z.enum(
  experimentRunTerminalStatuses,
);
export type ExperimentRunTerminalStatus = z.infer<
  typeof experimentRunTerminalStatusSchema
>;

const experimentRunTransitions: Readonly<
  Record<ExperimentRunStatus, readonly ExperimentRunStatus[]>
> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

/** Returns whether a lifecycle transition is legal; terminal states have no exits. */
export function canTransitionExperimentRunStatus(
  from: ExperimentRunStatus,
  to: ExperimentRunStatus,
): boolean {
  return experimentRunTransitions[from].includes(to);
}

export const experimentFailureCodes = [
  'experiment_timeout',
  'experiment_cancelled',
  'resource_quota_exceeded',
  'input_unavailable',
  'environment_unavailable',
  'execution_failed',
  'output_validation_failed',
] as const;
export const experimentFailureCodeSchema = z.enum(experimentFailureCodes);
export type ExperimentFailureCode = z.infer<typeof experimentFailureCodeSchema>;

/** Immutable execution request. It contains no network, GPU, image or shell field. */
export const experimentRunSchema = z
  .object({
    runId: opaqueIdSchema,
    notebookId: opaqueIdSchema,
    codeVersionId: opaqueIdSchema,
    codeHash: sha256Schema,
    environmentId: nonEmptyTrimmed,
    inputs: z.array(experimentInputMountSchema).min(1).max(32),
    dependencies: z.array(experimentDependencySchema).min(1).max(64),
    randomSeed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    resourceBudget: experimentResourceBudgetSchema,
  })
  .strict()
  .superRefine((run, ctx) => {
    const mountNames = run.inputs.map((input) => input.mountName);
    if (new Set(mountNames).size !== mountNames.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs'],
        message: 'Duplicate mount names are not allowed',
      });
    }
    const dependencyNames = run.dependencies.map(
      (dependency) => dependency.name,
    );
    if (new Set(dependencyNames).size !== dependencyNames.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['dependencies'],
        message: 'Duplicate dependency names are not allowed',
      });
    }
  });
export type ExperimentRun = z.infer<typeof experimentRunSchema>;

const resultFields = {
  runId: opaqueIdSchema,
  outputs: z
    .array(experimentOutputArtifactSchema)
    .max(MAX_EXPERIMENT_OUTPUT_FILES),
  logs: z.array(experimentLogEntrySchema).max(64),
};

/** Terminal success has no failure code and may only expose bounded Artifact outputs. */
export const experimentRunSucceededResultSchema = z
  .object({
    ...resultFields,
    status: z.literal('succeeded'),
    failureCode: z.null(),
  })
  .strict();

/** Terminal failure has a stable code and cannot present output Artifacts as success. */
export const experimentRunFailedResultSchema = z
  .object({
    ...resultFields,
    status: z.literal('failed'),
    failureCode: experimentFailureCodeSchema,
    outputs: z.array(experimentOutputArtifactSchema).length(0),
  })
  .strict();

/** Cancellation is terminal and does not present a failure code or outputs. */
export const experimentRunCancelledResultSchema = z
  .object({
    ...resultFields,
    status: z.literal('cancelled'),
    failureCode: z.null(),
    outputs: z.array(experimentOutputArtifactSchema).length(0),
  })
  .strict();

/** A result is terminal evidence only; queued and running snapshots are not results. */
export const experimentRunResultSchema = z.discriminatedUnion('status', [
  experimentRunSucceededResultSchema,
  experimentRunFailedResultSchema,
  experimentRunCancelledResultSchema,
]);
export type ExperimentRunResult = z.infer<typeof experimentRunResultSchema>;

/**
 * Reproducibility evidence is written only after a run reaches a terminal
 * state. It repeats no private runtime data and its outputs must match status.
 */
export const experimentProvenanceSchema = z
  .object({
    runId: opaqueIdSchema,
    codeVersionId: opaqueIdSchema,
    codeHash: sha256Schema,
    environmentId: nonEmptyTrimmed,
    dependencies: z.array(experimentDependencySchema),
    inputs: z.array(
      z
        .object({
          mountName: z.string().min(1).max(128),
          artifactId: opaqueIdSchema,
          artifactVersionId: opaqueIdSchema,
          checksum: sha256Schema,
        })
        .strict(),
    ),
    randomSeed: z.number().int().nonnegative(),
    resourceBudget: experimentResourceBudgetSchema,
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }),
    terminalStatus: experimentRunTerminalStatusSchema,
    failureCode: experimentFailureCodeSchema.nullable(),
    outputs: z
      .array(experimentOutputArtifactSchema)
      .max(MAX_EXPERIMENT_OUTPUT_FILES),
  })
  .strict()
  .superRefine((provenance, ctx) => {
    if (
      provenance.terminalStatus === 'failed' &&
      provenance.failureCode === null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Failed provenance must record a stable failure code',
      });
    }
    if (
      provenance.terminalStatus !== 'failed' &&
      provenance.failureCode !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Only failed provenance may have a failure code',
      });
    }
    if (
      provenance.terminalStatus !== 'succeeded' &&
      provenance.outputs.length > 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['outputs'],
        message: 'Only successful provenance may list output artifacts',
      });
    }
  });
export type ExperimentProvenance = z.infer<typeof experimentProvenanceSchema>;
