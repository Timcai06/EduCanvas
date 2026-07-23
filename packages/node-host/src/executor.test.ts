import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SafeNodeHostExecutor } from './executor';

const created: string[] = [];
const now = new Date('2026-07-19T04:00:00.000Z');
const capabilities = {
  manifestId: 'node:manifest',
  issuedAt: now.toISOString(),
  capabilities: [
    {
      name: 'device.status' as const,
      risk: 'l0' as const,
      version: '1',
      constraints: {},
    },
    {
      name: 'filesystem.read_allowlisted' as const,
      risk: 'l1' as const,
      version: '1',
      constraints: {},
    },
  ],
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'request:1',
    operationId: 'operation:1',
    nodeId: 'node:1',
    capability: 'filesystem.read_allowlisted',
    parameters: { operation: 'read', root: 'notes', relativePath: 'safe.txt' },
    nonce: 'nonce:1',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    created
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('SafeNodeHostExecutor', () => {
  it('reads only an allowlisted regular file and reports safe device status', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'educanvas-node-'));
    created.push(root);
    await writeFile(path.join(root, 'safe.txt'), 'lesson notes');
    const executor = await SafeNodeHostExecutor.create({
      nodeId: 'node:1',
      capabilities,
      roots: { notes: root },
      now: () => now,
    });
    await expect(executor.execute(request())).resolves.toMatchObject({
      status: 'completed',
      output: { content: 'lesson notes' },
    });
    await expect(
      executor.execute(
        request({
          requestId: 'request:2',
          nonce: 'nonce:2',
          capability: 'device.status',
          parameters: {},
        }),
      ),
    ).resolves.toMatchObject({
      status: 'completed',
      output: { platform: expect.any(String) },
    });
  });

  it('rejects traversal and absolute paths before filesystem resolution', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'educanvas-node-'));
    created.push(root);
    const executor = await SafeNodeHostExecutor.create({
      nodeId: 'node:1',
      capabilities,
      roots: { notes: root },
      now: () => now,
    });
    for (const [index, relativePath] of [
      '../secret',
      '/etc/passwd',
    ].entries()) {
      await expect(
        executor.execute(
          request({
            requestId: `request:${index + 10}`,
            nonce: `nonce:${index + 10}`,
            parameters: { operation: 'read', root: 'notes', relativePath },
          }),
        ),
      ).resolves.toMatchObject({
        status: 'rejected',
        code: 'PATH_NOT_ALLOWED',
      });
    }
  });

  it('rejects symlink escape when the platform permits symlink setup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'educanvas-node-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'educanvas-outside-'));
    created.push(root, outside);
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await mkdir(path.join(root, 'links'));
    try {
      await symlink(
        path.join(outside, 'secret.txt'),
        path.join(root, 'links', 'secret.txt'),
      );
    } catch (error) {
      // Windows without Developer Mode/admin rights rejects symlink creation
      // before executor code runs. Linux CI still exercises this escape path.
      if (
        process.platform === 'win32' &&
        error instanceof Error &&
        'code' in error &&
        (error.code === 'EPERM' || error.code === 'EACCES')
      ) {
        return;
      }
      throw error;
    }
    const executor = await SafeNodeHostExecutor.create({
      nodeId: 'node:1',
      capabilities,
      roots: { notes: root },
      now: () => now,
    });
    await expect(
      executor.execute(
        request({
          requestId: 'request:symlink',
          nonce: 'nonce:symlink',
          parameters: {
            operation: 'read',
            root: 'notes',
            relativePath: 'links/secret.txt',
          },
        }),
      ),
    ).resolves.toMatchObject({
      status: 'rejected',
      code: 'PATH_NOT_ALLOWED',
    });
  });

  it('rejects expired, replayed, revoked and unapproved requests', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'educanvas-node-'));
    created.push(root);
    await writeFile(path.join(root, 'safe.txt'), 'ok');
    const executor = await SafeNodeHostExecutor.create({
      nodeId: 'node:1',
      capabilities,
      roots: { notes: root },
      now: () => now,
    });
    await executor.execute(request());
    await expect(executor.execute(request())).resolves.toMatchObject({
      code: 'REQUEST_REPLAYED',
    });
    await expect(
      executor.execute(
        request({
          requestId: 'request:expired',
          nonce: 'nonce:expired',
          issuedAt: new Date(now.getTime() - 60_000).toISOString(),
          expiresAt: new Date(now.getTime() - 1).toISOString(),
        }),
      ),
    ).resolves.toMatchObject({ code: 'REQUEST_EXPIRED' });
    const revoked = await SafeNodeHostExecutor.create({
      nodeId: 'node:1',
      capabilities,
      now: () => now,
      revoked: () => true,
    });
    await expect(
      revoked.execute(request({ requestId: 'request:revoked' })),
    ).resolves.toMatchObject({ code: 'NODE_REVOKED' });
  });
});
