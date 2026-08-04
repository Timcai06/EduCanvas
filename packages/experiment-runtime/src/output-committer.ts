/**
 * Output committer — takes verified output files and registers them as
 * ExperimentOutputArtifact references. The committer is injected by the
 * composition root and receives only fully validated bytes, not host paths.
 *
 * U14-R2: commitOutputs is now required (no defaults), and receives
 * verified bytes instead of outputDir.
 */

import type {
  ExperimentOutputArtifact,
  ExperimentLogEntry,
} from '@educanvas/agent-core';
import type { VerifiedOutputFile } from './output-verifier';

export interface CommitContext {
  readonly runId: string;
}

export interface CommittedOutput {
  readonly artifacts: readonly ExperimentOutputArtifact[];
  readonly logs: readonly ExperimentLogEntry[];
}

export interface VerifiedFileWithBytes extends VerifiedOutputFile {
  readonly bytes: Uint8Array;
}

/**
 * Injected output committer function type.
 * The composition root provides this to decouple the adapter from
 * object storage implementation details.
 *
 * Receives verified bytes (not outputDir) for secure processing.
 */
export type OutputCommitterFn = (
  files: readonly VerifiedFileWithBytes[],
  context: CommitContext,
) => Promise<CommittedOutput>;
