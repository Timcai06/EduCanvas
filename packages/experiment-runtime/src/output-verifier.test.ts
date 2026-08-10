import { describe, expect, it } from 'vitest';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verifyOutputDirectory } from './output-verifier';

async function makeTmpDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `ov-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

const BUDGET = {
  maxOutputBytes: 1024 * 1024,
  maxOutputFiles: 10,
};

describe('verifyOutputDirectory', () => {
  it('passes with no files', async () => {
    const dir = await makeTmpDir();
    const result = await verifyOutputDirectory(dir, BUDGET);
    expect(result.passed).toBe(true);
    expect(result.files).toHaveLength(0);
    expect(result.totalByteSize).toBe(0);
  });

  it('passes with valid files', async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, 'result.json'), '{"ok":true}');
    await writeFile(path.join(dir, 'data.csv'), 'a,b,c\n1,2,3');

    const result = await verifyOutputDirectory(dir, BUDGET);
    expect(result.passed).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.totalByteSize).toBeGreaterThan(0);

    const jsonFile = result.files.find((f) => f.relativePath === 'result.json');
    expect(jsonFile).toBeDefined();
    expect(jsonFile!.mimeType).toBe('application/json');
    expect(jsonFile!.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('passes with subdirectories', async () => {
    const dir = await makeTmpDir();
    await mkdir(path.join(dir, 'subdir'));
    await writeFile(path.join(dir, 'subdir', 'nested.txt'), 'hello');

    const result = await verifyOutputDirectory(dir, BUDGET);
    expect(result.passed).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.relativePath).toBe('subdir/nested.txt');
  });

  it('rejects symlinks', async () => {
    const dir = await makeTmpDir();
    await symlink(path.join(dir, 'nonexistent'), path.join(dir, 'link'));

    const result = await verifyOutputDirectory(dir, BUDGET);
    expect(result.passed).toBe(false);
    expect(result.violation).toContain('Symlink');
    expect(result.violation).toContain('link');
  });

  it('rejects file exceeding maxOutputBytes', async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, 'big.bin'), 'x'.repeat(2048));

    const result = await verifyOutputDirectory(dir, {
      maxOutputBytes: 1024,
      maxOutputFiles: 10,
    });
    expect(result.passed).toBe(false);
    expect(result.violation).toContain('exceeds maxOutputBytes');
  });

  it('rejects total size exceeding maxOutputBytes', async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, 'a.bin'), 'x'.repeat(600));
    await writeFile(path.join(dir, 'b.bin'), 'x'.repeat(600));

    const result = await verifyOutputDirectory(dir, {
      maxOutputBytes: 1024,
      maxOutputFiles: 10,
    });
    expect(result.passed).toBe(false);
    expect(result.violation).toContain('Total output size exceeds');
  });

  it('rejects too many files', async () => {
    const dir = await makeTmpDir();
    for (let i = 0; i < 5; i++) {
      await writeFile(path.join(dir, `f${i}.txt`), `content ${i}`);
    }

    const result = await verifyOutputDirectory(dir, {
      maxOutputBytes: 1024 * 1024,
      maxOutputFiles: 3,
    });
    expect(result.passed).toBe(false);
    expect(result.violation).toContain('Too many output files');
  });

  it('computes real SHA-256 checksums', async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, 'test.txt'), 'hello world');

    const result = await verifyOutputDirectory(dir, BUDGET);
    expect(result.passed).toBe(true);
    expect(result.files[0]?.checksum).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
  });

  it('fails for non-existent directory', async () => {
    const result = await verifyOutputDirectory('/nonexistent/path', BUDGET);
    expect(result.passed).toBe(false);
    expect(result.violation).toContain('does not exist');
  });

  it('returns files in stable sorted order', async () => {
    const dir = await makeTmpDir();
    await writeFile(path.join(dir, 'z.txt'), 'z');
    await writeFile(path.join(dir, 'a.txt'), 'a');
    await writeFile(path.join(dir, 'm.txt'), 'm');

    const result = await verifyOutputDirectory(dir, BUDGET);
    expect(result.passed).toBe(true);
    expect(result.files.map((f) => f.relativePath)).toEqual([
      'a.txt',
      'm.txt',
      'z.txt',
    ]);
  });

  it('reports byteSize consistent with the actual bytes', async () => {
    const dir = await makeTmpDir();
    const content = 'hello world';
    await writeFile(path.join(dir, 'data.txt'), content);

    const result = await verifyOutputDirectory(dir, BUDGET);
    expect(result.passed).toBe(true);
    expect(result.files[0]?.byteSize).toBe(
      new TextEncoder().encode(content).byteLength,
    );
    expect(result.totalByteSize).toBe(result.files[0]!.byteSize);
  });

  it('rejects FIFOs', async () => {
    const dir = await makeTmpDir();
    const fifoPath = path.join(dir, 'pipe');
    const { execFileSync } = await import('node:child_process');
    execFileSync('mkfifo', [fifoPath]);

    const result = await verifyOutputDirectory(dir, BUDGET);
    expect(result.passed).toBe(false);
    expect(result.violation).toContain('Special file');
    expect(result.violation).toContain('pipe');
  });

  it('rejects unix sockets', async ({ skip }) => {
    const dir = await makeTmpDir();
    const socketPath = path.join(dir, 'sock');
    const net = await import('node:net');
    const server = net.createServer();
    // The socket file disappears when the server closes, so verify while the
    // listening socket still exists and close afterwards.
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, resolve);
      });
    } catch (error) {
      // macOS app sandboxes may forbid AF_UNIX bind entirely. Skip only that
      // host restriction; CI and normal shells still execute the rejection proof.
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'EPERM' || error.code === 'EACCES')
      ) {
        skip(`Host forbids Unix sockets: ${String(error.code)}`);
      }
      throw error;
    }
    try {
      const result = await verifyOutputDirectory(dir, BUDGET);
      expect(result.passed).toBe(false);
      expect(result.violation).toContain('Special file');
      expect(result.violation).toContain('sock');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects symlinked directories', async () => {
    const dir = await makeTmpDir();
    const target = await makeTmpDir();
    await symlink(target, path.join(dir, 'linkdir'));

    const result = await verifyOutputDirectory(dir, BUDGET);
    expect(result.passed).toBe(false);
    expect(result.violation).toContain('Symlink');
  });

  it('sorts nested files lexicographically across subdirectories', async () => {
    const dir = await makeTmpDir();
    await mkdir(path.join(dir, 'b'));
    await mkdir(path.join(dir, 'a'));
    await writeFile(path.join(dir, 'b', 'one.txt'), '1');
    await writeFile(path.join(dir, 'a', 'two.txt'), '2');

    const result = await verifyOutputDirectory(dir, BUDGET);
    expect(result.passed).toBe(true);
    expect(result.files.map((f) => f.relativePath)).toEqual([
      'a/two.txt',
      'b/one.txt',
    ]);
  });

  it('counts nested files against maxOutputFiles', async () => {
    const dir = await makeTmpDir();
    await mkdir(path.join(dir, 'sub'));
    await writeFile(path.join(dir, 'root.txt'), 'r');
    await writeFile(path.join(dir, 'sub', 'nested.txt'), 'n');

    const result = await verifyOutputDirectory(dir, {
      maxOutputBytes: 1024 * 1024,
      maxOutputFiles: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.violation).toContain('Too many output files');
  });
});
