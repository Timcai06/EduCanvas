/**
 * ExperimentRuntimePort — Tier 3 CPU-only, fixed-environment experiment boundary.
 *
 * This module is the **single authoritative source** for the experiment runtime
 * contract. Neither agent-core nor canvas-protocol shall duplicate these types.
 *
 * Invariants enforced by the contract:
 * - No network, GPU, custom images, runtime dependency installation.
 * - No absolute paths, `..` traversal, or empty mount names.
 * - No secret, objectKey, host path, raw bytes, or provider response in outputs.
 * - Inputs are immutable Artifact/Asset Version references with SHA-256 checksums.
 * - State machine has a closed set of statuses with no transition out of terminal.
 * - Resource budgets have finite, positive upper bounds that cannot be circumvented.
 */

import { z } from 'zod';
import type { ModelAbortSignal } from './model-contracts';

/* ────────────────────────────────────────────────────────────────────────────
 * Shared primitives
 * ──────────────────────────────────────────────────────────────────────────── */

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const nonEmptyTrimmed = z.string().min(1).max(256);

/* ────────────────────────────────────────────────────────────────────────────
 * Input mount — read-only Artifact/Asset Version reference
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Each experiment input is an immutable, versioned reference. The mount name
 * is a relative path segment used inside the execution sandbox. Absolute
 * paths and `..` segments are rejected.
 */
export const experimentInputMountSchema = z
  .object({
    /** Unique mount name inside the sandbox (relative path segment). */
    mountName: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    /** The artifact version this input points to. */
    artifactId: opaqueIdSchema,
    artifactVersionId: opaqueIdSchema,
    /** MIME type of the versioned content. */
    mimeType: z.string().min(1).max(255),
    /** SHA-256 checksum of the persisted content. */
    checksum: sha256Schema,
    /** Byte size of the persisted content. */
    byteSize: z
      .number()
      .int()
      .positive()
      .max(500 * 1024 * 1024),
    /** Optional human-readable label for UI display. */
    label: z.string().min(1).max(200).optional(),
  })
  .strict();
export type ExperimentInputMount = z.infer<typeof experimentInputMountSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Dependency — pinned name + locked version
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Dependencies must be an exact version — no ranges, no `latest`, no URLs.
 * Repeated dependency names are rejected by the run schema (superRefine).
 */
export const experimentDependencySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    /** Exact locked version — no ^, ~, >=, latest, tag, or URL. */
    version: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/),
  })
  .strict();
export type ExperimentDependency = z.infer<typeof experimentDependencySchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Resource budget — finite, bounded, non-circumventable
 * ──────────────────────────────────────────────────────────────────────────── */

/** Absolute platform upper bounds that callers cannot exceed. */
export const MAX_EXPERIMENT_DURATION_MS = 10 * 60_000; // 10 minutes
export const MAX_EXPERIMENT_MEMORY_MIB = 2 * 1024; // 2 GiB
export const MAX_EXPERIMENT_PROCESSES = 256;
export const MAX_EXPERIMENT_STDOUT_BYTES = 4 * 1024 * 1024; // 4 MiB
export const MAX_EXPERIMENT_LOG_BYTES = 8 * 1024 * 1024; // 8 MiB
export const MAX_EXPERIMENT_OUTPUT_BYTES = 50 * 1024 * 1024; // 50 MiB
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

/* ────────────────────────────────────────────────────────────────────────────
 * Output — bounded Artifact Version reference (no raw bytes/objectKey/hostPath)
 * ──────────────────────────────────────────────────────────────────────────── */

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

/**
 * A bounded log summary — never raw log bytes, objectKey, or host path.
 * Either a short in-line text (≤ 4 KiB) or an Artifact Version reference.
 */
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
      byteSize: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type ExperimentLogEntry = z.infer<typeof experimentLogEntrySchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * States — closed set with validated transitions
 * ──────────────────────────────────────────────────────────────────────────── */

export const experimentRunStatuses = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export const experimentRunStatusSchema = z.enum(experimentRunStatuses);
export type ExperimentRunStatus = z.infer<typeof experimentRunStatusSchema>;
export type ExperimentRunTerminalStatus = Extract<
  ExperimentRunStatus,
  'succeeded' | 'failed' | 'cancelled'
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

/** Pure function: checks whether a status transition is legal. */
export function canTransitionExperimentRunStatus(
  from: ExperimentRunStatus,
  to: ExperimentRunStatus,
): boolean {
  return experimentRunTransitions[from].includes(to);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Failure codes — stable, closed set
 * ──────────────────────────────────────────────────────────────────────────── */

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

/* ────────────────────────────────────────────────────────────────────────────
 * Run — immutable input contract
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A single deterministic experiment run. The schema rejects:
 * - Absolute paths, `..` traversal, empty mount names
 * - Custom Docker images, shell commands, GPU, network, runtime dependency install
 * - Version ranges, `latest`, tags, git URLs in dependencies
 * - Unknown / extra fields (strict mode)
 */
export const experimentRunSchema = z
  .object({
    /** Unique run identifier. */
    runId: opaqueIdSchema,
    /** Notebook this run belongs to. */
    notebookId: opaqueIdSchema,
    /** Immutable code version reference. */
    codeVersionId: opaqueIdSchema,
    /** SHA-256 of the code content. */
    codeHash: sha256Schema,
    /** Fixed execution environment identifier. */
    environmentId: nonEmptyTrimmed,
    /** Read-only input mounts. */
    inputs: z.array(experimentInputMountSchema).min(1).max(32),
    /** Pinned dependencies. */
    dependencies: z.array(experimentDependencySchema).min(1).max(64),
    /** Deterministic random seed for reproducibility. */
    randomSeed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    /** Explicit resource budget. */
    resourceBudget: experimentResourceBudgetSchema,
    /** Cancellation signal — not persisted, passed at runtime. */
  })
  .strict()
  .superRefine((run, ctx) => {
    // Reject duplicate mount names
    const mountNames = run.inputs.map((i) => i.mountName);
    const uniqueMountNames = new Set(mountNames);
    if (uniqueMountNames.size !== mountNames.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs'],
        message: 'Duplicate mount names are not allowed',
      });
    }
    // Reject duplicate dependency names
    const depNames = run.dependencies.map((d) => d.name);
    const uniqueDepNames = new Set(depNames);
    if (uniqueDepNames.size !== depNames.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['dependencies'],
        message: 'Duplicate dependency names are not allowed',
      });
    }
    // Reject version ranges, latest, tags, URLs
    const badVersionPattern = /[\^~>=<]|^latest$|^https?:|^git[+]/;
    for (const dep of run.dependencies) {
      if (badVersionPattern.test(dep.version)) {
        ctx.addIssue({
          code: 'custom',
          path: ['dependencies', dep.name],
          message: `Dependency version "${dep.version}" must be an exact locked version`,
        });
      }
    }
    // Reject absolute paths and .. traversal in mount names
    for (const input of run.inputs) {
      if (input.mountName.startsWith('/') || input.mountName.includes('..')) {
        ctx.addIssue({
          code: 'custom',
          path: ['inputs', input.mountName],
          message: `Mount name "${input.mountName}" must be a relative path without .. segments`,
        });
      }
    }
  });
export type ExperimentRun = z.infer<typeof experimentRunSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Result — terminal output with provenance
 * ──────────────────────────────────────────────────────────────────────────── */

export const experimentRunResultSchema = z
  .object({
    runId: opaqueIdSchema,
    status: experimentRunStatusSchema,
    failureCode: experimentFailureCodeSchema.nullable(),
    /** Output Artifact Version references — only on success. */
    outputs: z.array(experimentOutputArtifactSchema),
    /** Bounded log summary — never raw bytes or host paths. */
    logs: z.array(experimentLogEntrySchema).max(64),
  })
  .strict()
  .superRefine((result, ctx) => {
    const isTerminal =
      result.status === 'succeeded' ||
      result.status === 'failed' ||
      result.status === 'cancelled';
    if (
      result.status !== 'queued' &&
      result.status !== 'running' &&
      !isTerminal
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Non-terminal status not allowed in result',
      });
    }
    if (result.status === 'succeeded' && result.failureCode !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Successful runs must not have a failure code',
      });
    }
    if (result.status !== 'failed' && result.failureCode !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Only failed runs may have a failure code',
      });
    }
    if (result.status === 'failed' && result.failureCode === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureCode'],
        message: 'Failed runs must record a stable failure code',
      });
    }
    if (result.status !== 'succeeded' && result.outputs.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['outputs'],
        message: 'Only successful runs may produce output artifacts',
      });
    }
  });
export type ExperimentRunResult = z.infer<typeof experimentRunResultSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Provenance — reproducibility record
 * ──────────────────────────────────────────────────────────────────────────── */

export const experimentProvenanceSchema = z
  .object({
    runId: opaqueIdSchema,
    codeVersionId: opaqueIdSchema,
    codeHash: sha256Schema,
    environmentId: nonEmptyTrimmed,
    /** Exact dependency set — name + locked version for each. */
    dependencies: z.array(experimentDependencySchema),
    /** Input versions with checksums for reproducibility. */
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
    /** Actual resource limits applied by the adapter. */
    resourceBudget: experimentResourceBudgetSchema,
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }).nullable(),
    terminalStatus: experimentRunStatusSchema,
    /** Output Artifact Version references. */
    outputs: z.array(experimentOutputArtifactSchema),
  })
  .strict();
export type ExperimentProvenance = z.infer<typeof experimentProvenanceSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Events — runtime → host streaming protocol
 * ──────────────────────────────────────────────────────────────────────────── */

export const experimentRunEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started') }).strict(),
  z
    .object({
      type: z.literal('output'),
      kind: z.enum(['stdout', 'stderr']),
      content: z.string().max(65536),
    })
    .strict(),
  z
    .object({
      type: z.literal('log'),
      entry: experimentLogEntrySchema,
    })
    .strict(),
  z.object({ type: z.literal('succeeded') }).strict(),
  z
    .object({
      type: z.literal('failed'),
      failureCode: experimentFailureCodeSchema,
    })
    .strict(),
  z.object({ type: z.literal('cancelled') }).strict(),
]);
export type ExperimentRunEvent = z.infer<typeof experimentRunEventSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Port — the execution boundary
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ExperimentRuntimePort {
  /**
   * Execute one immutable experiment run. The implementation owns process
   * isolation, resource enforcement, and output collection — never an Agent
   * loop. Cancellation via `signal` must be respected promptly.
   */
  execute(
    run: ExperimentRun,
    signal: ModelAbortSignal,
  ): AsyncIterable<ExperimentRunEvent>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Rejection predicates — used by adapters to reject invalid inputs
 * ──────────────────────────────────────────────────────────────────────────── */

/** Returns true if the input is an object with `network: true` or similar forbidden capabilities. */
export function rejectsNetworkCapability(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const obj = input as Record<string, unknown>;
  if (obj.network === true || obj.enableNetwork === true) return true;
  if (typeof obj.capabilities === 'object' && obj.capabilities !== null) {
    const caps = obj.capabilities as Record<string, unknown>;
    if (caps.network === true) return true;
  }
  return false;
}

/** Returns true if the input requests GPU. */
export function rejectsGpuCapability(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const obj = input as Record<string, unknown>;
  if (obj.gpu === true || obj.enableGpu === true) return true;
  if (typeof obj.capabilities === 'object' && obj.capabilities !== null) {
    const caps = obj.capabilities as Record<string, unknown>;
    if (caps.gpu === true) return true;
  }
  return false;
}

/** Returns true if the input references a custom Docker image or shell command. */
export function rejectsCustomImageOrShell(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const obj = input as Record<string, unknown>;
  if (typeof obj.image === 'string') return true;
  if (typeof obj.dockerImage === 'string') return true;
  if (typeof obj.shell === 'string') return true;
  if (typeof obj.command === 'string') return true;
  return false;
}
