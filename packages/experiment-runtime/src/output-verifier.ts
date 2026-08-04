/**
 * Output verification for experiment runs.
 *
 * Scans the output directory for files, rejects symlinks, FIFOs, sockets,
 * device files, and path traversal. Computes real SHA-256 checksums.
 * Only passes data to ObjectStoragePort after ALL checks succeed.
 *
 * ## Rejection rules
 * - Non-existent directory → failure
 * - Symlink → failure
 * - FIFO / socket / block / char device → failure
 * - Path outside outputDir (via realpath) → failure
 * - File exceeding maxOutputBytes → failure
 * - Total size exceeding maxOutputBytes → failure
 * - File count exceeding maxOutputFiles → failure
 */

import { createHash } from 'node:crypto';
import { readdir, lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ExperimentResourceBudget } from '@educanvas/agent-core';

export interface VerifiedOutputFile {
  readonly relativePath: string;
  readonly mimeType: string;
  readonly checksum: string;
  readonly byteSize: number;
}

export interface OutputVerificationResult {
  readonly passed: boolean;
  readonly files: readonly VerifiedOutputFile[];
  readonly totalByteSize: number;
  readonly violation?: string;
}

const S_IFMT = 0o170000;
const S_IFIFO = 0o010000;
const S_IFCHR = 0o020000;
const S_IFBLK = 0o060000;
const S_IFSOCK = 0o140000;

function inferMimeType(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.py': 'text/x-python',
    '.pdf': 'application/pdf',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.parquet': 'application/octet-stream',
    '.arrow': 'application/octet-stream',
  };
  return mimeMap[ext] ?? 'application/octet-stream';
}

function isSpecialFile(mode: number): boolean {
  const type = mode & S_IFMT;
  return (
    type === S_IFIFO ||
    type === S_IFCHR ||
    type === S_IFBLK ||
    type === S_IFSOCK
  );
}

async function walkDir(
  dir: string,
  outputDirReal: string,
  relativeBase: string,
  budget: Pick<ExperimentResourceBudget, 'maxOutputBytes' | 'maxOutputFiles'>,
  files: VerifiedOutputFile[],
): Promise<{ totalByteSize: number; violation?: string }> {
  let totalByteSize = 0;

  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return {
      totalByteSize: 0,
      violation: `Output directory not accessible: ${dir}`,
    };
  }

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = relativeBase
      ? `${relativeBase}/${entry.name}`
      : entry.name;

    if (entry.isSymbolicLink()) {
      return {
        totalByteSize,
        violation: `Symlink not allowed: ${relativePath}`,
      };
    }

    const stat = await lstat(absolutePath);

    if (isSpecialFile(stat.mode)) {
      return {
        totalByteSize,
        violation: `Special file not allowed: ${relativePath}`,
      };
    }

    if (entry.isDirectory()) {
      const sub = await walkDir(
        absolutePath,
        outputDirReal,
        relativePath,
        budget,
        files,
      );
      totalByteSize += sub.totalByteSize;
      if (sub.violation) return { totalByteSize, violation: sub.violation };
      continue;
    }

    if (!entry.isFile()) {
      return {
        totalByteSize,
        violation: `Non-regular file not allowed: ${relativePath}`,
      };
    }

    let realPath: string;
    try {
      realPath = await realpath(absolutePath);
    } catch {
      return {
        totalByteSize,
        violation: `Cannot resolve path: ${relativePath}`,
      };
    }
    const relativeToRoot = path.relative(outputDirReal, realPath);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      return {
        totalByteSize,
        violation: `Path traversal not allowed: ${relativePath}`,
      };
    }

    if (stat.size > budget.maxOutputBytes) {
      return {
        totalByteSize,
        violation: `File ${relativePath} exceeds maxOutputBytes (${stat.size} > ${budget.maxOutputBytes})`,
      };
    }

    totalByteSize += stat.size;

    if (totalByteSize > budget.maxOutputBytes) {
      return {
        totalByteSize,
        violation: `Total output size exceeds maxOutputBytes (${totalByteSize} > ${budget.maxOutputBytes})`,
      };
    }

    if (files.length >= budget.maxOutputFiles) {
      return {
        totalByteSize,
        violation: `Too many output files (${files.length + 1} > ${budget.maxOutputFiles})`,
      };
    }

    const bytes = await readFile(absolutePath);
    const checksum = createHash('sha256').update(bytes).digest('hex');

    files.push({
      relativePath,
      mimeType: inferMimeType(relativePath),
      checksum,
      byteSize: stat.size,
    });
  }

  return { totalByteSize };
}

export async function verifyOutputDirectory(
  outputDir: string,
  budget: Pick<ExperimentResourceBudget, 'maxOutputBytes' | 'maxOutputFiles'>,
): Promise<OutputVerificationResult> {
  let outputDirReal: string;
  try {
    outputDirReal = await realpath(outputDir);
  } catch {
    return {
      passed: false,
      files: [],
      totalByteSize: 0,
      violation: `Output directory does not exist: ${outputDir}`,
    };
  }

  const files: VerifiedOutputFile[] = [];
  const { totalByteSize, violation } = await walkDir(
    outputDir,
    outputDirReal,
    '',
    budget,
    files,
  );

  if (violation) {
    return { passed: false, files: [], totalByteSize: 0, violation };
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return { passed: true, files, totalByteSize };
}
