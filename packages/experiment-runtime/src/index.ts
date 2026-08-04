/**
 * @educanvas/experiment-runtime — CPU Experiment Adapter.
 *
 * Implements ExperimentRuntimePort for networkless, CPU-only experiment
 * execution in Docker containers with platform-controlled environments.
 *
 * @packageDocumentation
 */

export { CpuExperimentAdapter } from './cpu-experiment-adapter';
export type { CpuExperimentAdapterOptions } from './cpu-experiment-adapter';

export {
  EXPERIMENT_ENVIRONMENTS,
  findEnvironment,
  isEnvironmentAllowed,
  findAllowedDependency,
} from './environment-whitelist';
export type {
  ExperimentEnvironment,
  AllowedDependency,
} from './environment-whitelist';

export { buildDockerRunCommand, deriveContainerName } from './docker-command';
export type { DockerCommandInput } from './docker-command';

export {
  runDockerContainer,
  mapTerminationToFailureCode,
  splitIntoChunks,
  isCleanRunResult,
} from './docker-process-runner';
export type {
  DockerProcessRunnerOptions,
  RunResult,
  TerminationReason,
} from './docker-process-runner';

export { createDefaultDockerProcessPort } from './docker-process-port';
export type {
  DockerProcessPort,
  DockerChildProcess,
  DockerRunOptions,
  DockerRmForceOptions,
} from './docker-process-port';

export {
  materializeRun,
  sha256hex,
  MaterializationError,
} from './run-materializer';
export type {
  ResolveCodeFn,
  ResolveInputFn,
  CodeResolution,
  InputResolution,
  ResolvedMaterial,
} from './run-materializer';

export { verifyOutputDirectory } from './output-verifier';
export type {
  VerifiedOutputFile,
  OutputVerificationResult,
} from './output-verifier';

export type {
  OutputCommitterFn,
  CommitContext,
  CommittedOutput,
  VerifiedFileWithBytes,
} from './output-committer';

export { createEventQueue } from './event-queue';
export type { EventQueue } from './event-queue';
