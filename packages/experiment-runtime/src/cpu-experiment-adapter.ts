/**
 * CPU Experiment Adapter — orchestrator implementing ExperimentRuntimePort.
 *
 * Coordinates:
 * 1. Environment and dependency validation
 * 2. Code and input materialization (hash/size verification)
 * 3. Docker command construction
 * 4. Container execution with output streaming (via runDockerContainer)
 * 5. Output verification and Artifact registration
 * 6. Temp directory cleanup
 *
 * Each concern is in a separate module; this file is the thin glue.
 *
 * U14-R2 changes:
 * - Real AsyncQueue-based AsyncIterable (not emit callbacks)
 * - All docker run + docker rm -f go through the injected DockerProcessPort
 * - MaterializationError → input_unavailable (not execution_failed)
 * - commitOutputs is required and receives verified bytes (not outputDir)
 * - Real provenance timestamps with injected clock (finishedAt >= startedAt)
 * - Strict termination mapping: timeout → experiment_timeout, user abort →
 *   cancelled, quota → resource_quota_exceeded
 */

import { mkdir, chmod, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  experimentOutputArtifactSchema,
  type ExperimentRun,
  type ExperimentRunEvent,
  type ExperimentRuntimePort,
  type ModelAbortSignal,
  type ExperimentOutputArtifact,
  type ExperimentFailureCode,
} from '@educanvas/agent-core';
import {
  type ExperimentEnvironment,
  findEnvironment,
} from './environment-whitelist';
import {
  type ResolveCodeFn,
  type ResolveInputFn,
  materializeRun,
  MaterializationError,
  sha256hex,
} from './run-materializer';
import { buildDockerRunCommand, deriveContainerName } from './docker-command';
import { runDockerContainer, isCleanRunResult } from './docker-process-runner';
import { verifyOutputDirectory } from './output-verifier';
import {
  type OutputCommitterFn,
  type CommittedOutput,
  type VerifiedFileWithBytes,
} from './output-committer';
import type { DockerProcessPort } from './docker-process-port';
import { createEventQueue, type EventQueue } from './event-queue';

export interface CpuExperimentAdapterOptions {
  resolveCode: ResolveCodeFn;
  resolveInput: ResolveInputFn;
  commitOutputs: OutputCommitterFn;
  dockerPort: DockerProcessPort;
  /** Injected clock for provenance timestamps; defaults to the real clock. */
  clock?: () => Date;
}

export class CpuExperimentAdapter implements ExperimentRuntimePort {
  private readonly resolveCode: ResolveCodeFn;
  private readonly resolveInput: ResolveInputFn;
  private readonly commitOutputs: OutputCommitterFn;
  private readonly dockerPort: DockerProcessPort;
  private readonly clock: () => Date;

  constructor(options: CpuExperimentAdapterOptions) {
    if (typeof options.commitOutputs !== 'function') {
      throw new TypeError('commitOutputs must be a function');
    }
    this.resolveCode = options.resolveCode;
    this.resolveInput = options.resolveInput;
    this.commitOutputs = options.commitOutputs;
    this.dockerPort = options.dockerPort;
    this.clock = options.clock ?? (() => new Date());
  }

  async *execute(
    run: ExperimentRun,
    signal: ModelAbortSignal,
  ): AsyncIterable<ExperimentRunEvent> {
    const queue = createEventQueue();

    // Execute in the background and stream real queued events; the consumer
    // observes the run through the queue with natural backpressure.
    void this.executeRun(run, signal, queue).catch((error) => {
      queue.fail(error);
    });

    yield* queue;
  }

  private async executeRun(
    run: ExperimentRun,
    signal: ModelAbortSignal,
    queue: EventQueue,
  ): Promise<void> {
    try {
      await this.executeRunInner(run, signal, queue);
    } finally {
      queue.close();
    }
  }

  private async executeRunInner(
    run: ExperimentRun,
    signal: ModelAbortSignal,
    queue: EventQueue,
  ): Promise<void> {
    const env = this.validateEnvironment(run);
    if (!env) {
      queue.push(this.makeFailedEvent(run, 'environment_unavailable'));
      return;
    }

    if (!this.validateDependencies(run, env)) {
      queue.push(this.makeFailedEvent(run, 'environment_unavailable'));
      return;
    }

    if (signal.aborted) {
      queue.push(this.makeCancelledEvent(run));
      return;
    }

    let startedAt: Date | undefined;
    let tempRoot: string | null = null;
    let terminalEmitted = false;

    const pushTerminalOnce = (event: ExperimentRunEvent): void => {
      if (terminalEmitted) return;
      terminalEmitted = true;
      queue.push(event);
    };

    try {
      const material = await materializeRun(
        run.codeVersionId,
        run.codeHash,
        run.inputs,
        this.resolveCode,
        this.resolveInput,
      );
      tempRoot = material.tempRoot;

      // The output directory must exist for the bind mount; chmod 777 keeps
      // it writable by the container's unprivileged uid 1000 (the mkdtemp
      // parent stays private to the host user).
      const outputDir = join(tempRoot, 'output');
      await mkdir(outputDir, { recursive: true });
      await chmod(outputDir, 0o777);

      startedAt = this.clock();

      const dockerCmd = buildDockerRunCommand({
        runId: run.runId,
        environment: env,
        codeDir: material.codeDir,
        inputDirs: material.inputDirs,
        outputDir,
        maxMemoryMiB: run.resourceBudget.maxMemoryMiB,
        maxProcesses: run.resourceBudget.maxProcesses,
        maxDurationMs: run.resourceBudget.maxDurationMs,
      });

      const containerName = deriveContainerName(run.runId);

      const result = await runDockerContainer({
        command: dockerCmd,
        budget: run.resourceBudget,
        containerName,
        dockerPort: this.dockerPort,
        signal,
        queue,
      });

      if (!terminalEmitted) {
        switch (result.terminationReason) {
          case 'user_cancel':
            pushTerminalOnce(this.makeCancelledEvent(run, startedAt));
            break;
          case 'timeout':
            pushTerminalOnce(
              this.makeFailedEvent(run, 'experiment_timeout', startedAt),
            );
            break;
          case 'stdout_quota':
          case 'stderr_quota':
            pushTerminalOnce(
              this.makeFailedEvent(run, 'resource_quota_exceeded', startedAt),
            );
            break;
          case 'spawn_error':
            pushTerminalOnce(
              this.makeFailedEvent(run, 'execution_failed', startedAt),
            );
            break;
          case 'process_exit':
            if (isCleanRunResult(result)) {
              await this.handleSuccess(
                run,
                outputDir,
                startedAt,
                pushTerminalOnce,
              );
            } else {
              pushTerminalOnce(
                this.makeFailedEvent(run, 'execution_failed', startedAt),
              );
            }
            break;
        }
      }
    } catch (error) {
      if (!terminalEmitted) {
        if (error instanceof MaterializationError) {
          // R2-05: staged inputs are invalid → input_unavailable
          pushTerminalOnce(
            this.makeFailedEvent(run, 'input_unavailable', startedAt),
          );
        } else {
          pushTerminalOnce(
            this.makeFailedEvent(run, 'execution_failed', startedAt),
          );
        }
      }
    } finally {
      if (tempRoot) {
        await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  private validateEnvironment(
    run: ExperimentRun,
  ): ExperimentEnvironment | null {
    return findEnvironment(run.environmentId) ?? null;
  }

  private validateDependencies(
    run: ExperimentRun,
    env: ExperimentEnvironment,
  ): boolean {
    for (const dep of run.dependencies) {
      const allowed = env.allowedDependencies.find(
        (d) => d.name === dep.name && d.version === dep.version,
      );
      if (!allowed) return false;
    }
    return true;
  }

  private async handleSuccess(
    run: ExperimentRun,
    outputDir: string,
    startedAt: Date,
    pushTerminalOnce: (event: ExperimentRunEvent) => void,
  ): Promise<void> {
    try {
      const verification = await verifyOutputDirectory(
        outputDir,
        run.resourceBudget,
      );
      if (!verification.passed) {
        pushTerminalOnce(this.makeFailedEvent(run, 'output_validation_failed'));
        return;
      }

      // R2-06: pass fully verified bytes to the committer, never host paths.
      const filesWithBytes: VerifiedFileWithBytes[] = [];
      for (const file of verification.files) {
        const bytes = await readVerifiedFile(
          join(outputDir, file.relativePath),
        );
        if (
          bytes.byteLength !== file.byteSize ||
          sha256hex(bytes) !== file.checksum
        ) {
          throw new Error('Verified output changed before commit');
        }
        filesWithBytes.push({ ...file, bytes });
      }

      const committed: CommittedOutput = await this.commitOutputs(
        filesWithBytes,
        { runId: run.runId },
      );

      const verifiedArtifacts = this.verifyCommittedArtifacts(
        committed.artifacts,
        verification.files,
      );

      pushTerminalOnce({
        type: 'succeeded',
        result: {
          runId: run.runId,
          status: 'succeeded',
          failureCode: null,
          outputs: [...verifiedArtifacts],
          logs: [...committed.logs],
        },
        provenance: this.makeProvenance(
          run,
          'succeeded',
          null,
          verifiedArtifacts,
          startedAt,
        ),
      });
    } catch {
      // Verification, reading, committer, or artifact mismatch failures all
      // surface as output_validation_failed without leaking internals.
      pushTerminalOnce({
        type: 'failed',
        result: {
          runId: run.runId,
          status: 'failed',
          failureCode: 'output_validation_failed',
          outputs: [],
          logs: [],
        },
        provenance: this.makeProvenance(
          run,
          'failed',
          'output_validation_failed',
          [],
          startedAt,
        ),
      });
    }
  }

  private verifyCommittedArtifacts(
    artifacts: readonly ExperimentOutputArtifact[],
    verifiedFiles: readonly {
      readonly checksum: string;
      readonly byteSize: number;
      readonly mimeType: string;
    }[],
  ): readonly ExperimentOutputArtifact[] {
    if (artifacts.length !== verifiedFiles.length) {
      throw new Error('Committed artifact count mismatch');
    }
    for (let i = 0; i < artifacts.length; i++) {
      const artifact = experimentOutputArtifactSchema.parse(artifacts[i]);
      if (artifact.checksum !== verifiedFiles[i]!.checksum) {
        throw new Error('Committed artifact checksum mismatch');
      }
      if (artifact.byteSize !== verifiedFiles[i]!.byteSize) {
        throw new Error('Committed artifact byteSize mismatch');
      }
      if (artifact.mimeType !== verifiedFiles[i]!.mimeType) {
        throw new Error('Committed artifact mimeType mismatch');
      }
    }
    return artifacts;
  }

  private makeFailedEvent(
    run: ExperimentRun,
    failureCode: ExperimentFailureCode,
    startedAt?: Date,
  ): ExperimentRunEvent {
    return {
      type: 'failed',
      result: {
        runId: run.runId,
        status: 'failed',
        failureCode,
        outputs: [],
        logs: [],
      },
      provenance: this.makeProvenance(
        run,
        'failed',
        failureCode,
        [],
        startedAt,
      ),
    };
  }

  private makeCancelledEvent(
    run: ExperimentRun,
    startedAt?: Date,
  ): ExperimentRunEvent {
    return {
      type: 'cancelled',
      result: {
        runId: run.runId,
        status: 'cancelled',
        failureCode: null,
        outputs: [],
        logs: [],
      },
      provenance: this.makeProvenance(run, 'cancelled', null, [], startedAt),
    };
  }

  private makeProvenance(
    run: ExperimentRun,
    terminalStatus: 'succeeded' | 'failed' | 'cancelled',
    failureCode: ExperimentFailureCode | null,
    outputs: readonly ExperimentOutputArtifact[],
    startedAt?: Date,
  ) {
    const finishedAt = this.clock();
    const started = startedAt ?? finishedAt;
    return {
      runId: run.runId,
      codeVersionId: run.codeVersionId,
      codeHash: run.codeHash,
      environmentId: run.environmentId,
      dependencies: [...run.dependencies],
      inputs: run.inputs.map((i) => ({
        mountName: i.mountName,
        artifactId: i.artifactId,
        artifactVersionId: i.artifactVersionId,
        checksum: i.checksum,
      })),
      randomSeed: run.randomSeed,
      resourceBudget: run.resourceBudget,
      startedAt: started.toISOString(),
      finishedAt: finishedAt.toISOString(),
      terminalStatus,
      failureCode,
      outputs: terminalStatus === 'succeeded' ? [...outputs] : [],
    };
  }
}

/**
 * Read a file into memory for commit; the output was already verified and
 * bounded, so this can never exceed the budget unless the directory was
 * mutated between verification and read (which yields output_validation_failed).
 */
async function readVerifiedFile(filePath: string): Promise<Uint8Array> {
  return readFile(filePath);
}
