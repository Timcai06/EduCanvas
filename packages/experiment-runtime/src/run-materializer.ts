/**
 * Run materializer — resolves code and inputs to bytes, verifies hashes
 * and sizes, and stages them into private temp directories. No host paths
 * are passed to Docker; only controlled internal paths are used.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ExperimentInputMount } from '@educanvas/agent-core';

export interface CodeResolution {
  readonly bytes: Uint8Array;
  readonly checksum: string;
}

export interface InputResolution {
  readonly bytes: Uint8Array;
  readonly checksum: string;
  readonly byteSize: number;
}

export interface ResolvedMaterial {
  readonly codeDir: string;
  readonly inputDirs: Map<string, string>;
  readonly tempRoot: string;
}

export type ResolveCodeFn = (
  codeVersionId: string,
  codeHash: string,
) => Promise<CodeResolution>;

export type ResolveInputFn = (
  input: ExperimentInputMount,
) => Promise<InputResolution>;

export function sha256hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * MaterializationError with specific failure codes.
 * Maps to `input_unavailable` in the adapter (not `execution_failed`).
 */
export class MaterializationError extends Error {
  constructor(
    readonly code:
      | 'code_hash_mismatch'
      | 'input_checksum_mismatch'
      | 'input_size_mismatch'
      | 'resolution_failed',
    message: string,
  ) {
    super(message);
    this.name = 'MaterializationError';
  }
}

/**
 * Wrap a resolver failure in MaterializationError so the adapter can map any
 * code/input resolution problem to `input_unavailable`.
 */
async function resolveCodeSafe(
  run: () => Promise<CodeResolution>,
  what: string,
): Promise<CodeResolution> {
  try {
    return await run();
  } catch {
    throw new MaterializationError('resolution_failed', `${what} failed`);
  }
}

async function resolveInputSafe(
  run: () => Promise<InputResolution>,
): Promise<InputResolution> {
  try {
    return await run();
  } catch {
    throw new MaterializationError(
      'resolution_failed',
      `Resolving input failed`,
    );
  }
}

/**
 * Stage code and inputs into a private temp directory tree.
 * Returns controlled paths safe for Docker volume mounts.
 * The caller is responsible for cleaning up tempRoot.
 */
export async function materializeRun(
  codeVersionId: string,
  codeHash: string,
  inputs: readonly ExperimentInputMount[],
  resolveCode: ResolveCodeFn,
  resolveInput: ResolveInputFn,
): Promise<ResolvedMaterial> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'experiment-'));

  try {
    const codeDir = path.join(tempRoot, 'code');
    await mkdir(codeDir, { recursive: true });

    const codeRes = await resolveCodeSafe(
      () => resolveCode(codeVersionId, codeHash),
      `Resolving code version ${codeVersionId}`,
    );
    const actualCodeHash = sha256hex(codeRes.bytes);
    if (actualCodeHash !== codeHash) {
      throw new MaterializationError(
        'code_hash_mismatch',
        `Code hash mismatch: expected ${codeHash}, got ${actualCodeHash}`,
      );
    }
    await writeFile(path.join(codeDir, 'main.py'), codeRes.bytes);

    const inputDirs = new Map<string, string>();
    for (const input of inputs) {
      const inputDir = path.join(tempRoot, 'inputs', input.mountName);
      await mkdir(inputDir, { recursive: true });

      const inputRes = await resolveInputSafe(() => resolveInput(input));
      const actualChecksum = sha256hex(inputRes.bytes);
      if (actualChecksum !== input.checksum) {
        throw new MaterializationError(
          'input_checksum_mismatch',
          `Input ${input.mountName} checksum mismatch: expected ${input.checksum}, got ${actualChecksum}`,
        );
      }
      if (inputRes.bytes.byteLength !== input.byteSize) {
        throw new MaterializationError(
          'input_size_mismatch',
          `Input ${input.mountName} size mismatch: expected ${input.byteSize}, got ${inputRes.bytes.byteLength}`,
        );
      }
      await writeFile(path.join(inputDir, 'data'), inputRes.bytes);
      inputDirs.set(input.mountName, inputDir);
    }

    return { codeDir, inputDirs, tempRoot };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
