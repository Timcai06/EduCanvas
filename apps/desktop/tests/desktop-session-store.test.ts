import { describe, expect, it } from 'vitest';
import { createDesktopSessionStore } from '../src/main/desktop-session-store';

const session = {
  token: `ecs1_${'t'.repeat(43)}`,
  expiresAt: '2026-09-10T08:00:00.000Z',
  webBaseUrl: 'https://learn.educanvas.example',
  gatewayBaseUrl: 'https://gateway.educanvas.example',
  userId: 'user:one',
  notebookId: 'notebook:one',
  conversationId: 'conversation:one',
};

function harness(
  options: {
    available?: boolean;
    decrypt?: () => Promise<{
      result: string;
      shouldReEncrypt: boolean;
      isTemporarilyUnavailable?: boolean;
    }>;
  } = {},
) {
  const files = new Map<string, Buffer>();
  let encryptions = 0;
  const store = createDesktopSessionStore({
    filePath: 'C:\\user-data\\desktop-session.enc',
    now: () => new Date('2026-08-11T08:00:00.000Z'),
    safeStorage: {
      isAsyncEncryptionAvailable: async () => options.available ?? true,
      encryptStringAsync: async (value) => {
        encryptions += 1;
        return Buffer.from(value, 'utf8').reverse();
      },
      decryptStringAsync:
        options.decrypt ??
        (async (value) => ({
          result: Buffer.from(value).reverse().toString('utf8'),
          shouldReEncrypt: false,
        })),
    },
    fileSystem: {
      async mkdir() {},
      async readFile(path) {
        const value = files.get(path);
        if (!value)
          throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return value;
      },
      async writeFile(path, data) {
        files.set(path, Buffer.from(data));
      },
      async rename(from, to) {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
      async unlink(path) {
        files.delete(path);
      },
    },
  });
  return { store, files, encryptions: () => encryptions };
}

describe('desktop session store', () => {
  it('persists only encrypted bytes and restores a strict active session', async () => {
    const { store, files } = harness();
    await store.save(session);
    const bytes = files.get('C:\\user-data\\desktop-session.enc')!;
    expect(bytes.toString('utf8')).not.toContain(session.token);
    await expect(store.load()).resolves.toEqual(session);
  });

  it('never falls back to plaintext when OS encryption is unavailable', async () => {
    const { store, files } = harness({ available: false });
    await expect(store.save(session)).rejects.toThrow(
      'desktop_secure_storage_unavailable',
    );
    expect(files.size).toBe(0);
  });

  it('fails closed for corrupt, invalid or expired plaintext', async () => {
    for (const result of [
      'not-json',
      JSON.stringify({ ...session, token: 'web-cookie-token' }),
      JSON.stringify({ ...session, expiresAt: '2026-01-01T00:00:00.000Z' }),
    ]) {
      const { store, files } = harness({
        decrypt: async () => ({ result, shouldReEncrypt: false }),
      });
      files.set('C:\\user-data\\desktop-session.enc', Buffer.from('cipher'));
      await expect(store.load()).resolves.toBeNull();
      expect(files.size).toBe(0);
    }
  });

  it('re-encrypts valid plaintext after OS key rotation', async () => {
    const { store, files, encryptions } = harness({
      decrypt: async () => ({
        result: JSON.stringify(session),
        shouldReEncrypt: true,
      }),
    });
    files.set('C:\\user-data\\desktop-session.enc', Buffer.from('old-cipher'));
    await expect(store.load()).resolves.toEqual(session);
    expect(encryptions()).toBe(1);
  });
});
