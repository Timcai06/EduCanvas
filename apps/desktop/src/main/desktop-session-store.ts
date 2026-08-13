import { dirname } from 'node:path';
import {
  gatewayDesktopSessionTokenSchema,
  gatewayOpaqueIdSchema,
} from '@educanvas/gateway-core';

export interface StoredDesktopSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly webBaseUrl: string;
  readonly gatewayBaseUrl: string;
  readonly userId: string;
  readonly notebookId: string;
  readonly conversationId: string;
}

interface SafeStoragePort {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{
    result: string;
    shouldReEncrypt: boolean;
  }>;
}

interface FileSystemPort {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  readFile(path: string): Promise<Buffer>;
  writeFile(
    path: string,
    data: Buffer,
    options: { mode: number },
  ): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  unlink(path: string): Promise<unknown>;
}

function isAllowedRemoteBase(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const secure =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    return Boolean(
      secure && !url.username && !url.password && !url.search && !url.hash,
    );
  } catch {
    return false;
  }
}

function parseSession(raw: string, now: Date): StoredDesktopSession | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(',') !==
        'conversationId,expiresAt,gatewayBaseUrl,notebookId,token,userId,webBaseUrl' ||
      !gatewayDesktopSessionTokenSchema.safeParse(value.token).success ||
      !gatewayOpaqueIdSchema.safeParse(value.userId).success ||
      !gatewayOpaqueIdSchema.safeParse(value.notebookId).success ||
      !gatewayOpaqueIdSchema.safeParse(value.conversationId).success ||
      typeof value.expiresAt !== 'string' ||
      !isAllowedRemoteBase(value.webBaseUrl) ||
      !isAllowedRemoteBase(value.gatewayBaseUrl)
    ) {
      return null;
    }
    const expiresAt = new Date(value.expiresAt);
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    return value as unknown as StoredDesktopSession;
  } catch {
    return null;
  }
}

/**
 * Electron safeStorage only encrypts bytes; this store owns the atomic encrypted file.
 * See https://www.electronjs.org/docs/latest/api/safe-storage
 */
export function createDesktopSessionStore(options: {
  filePath: string;
  safeStorage: SafeStoragePort;
  fileSystem: FileSystemPort;
  now?: () => Date;
}) {
  const temporaryPath = `${options.filePath}.tmp`;
  const now = options.now ?? (() => new Date());

  const clear = async (): Promise<void> => {
    for (const path of [options.filePath, temporaryPath]) {
      await options.fileSystem.unlink(path).catch((error: unknown) => {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      });
    }
  };

  const save = async (session: StoredDesktopSession): Promise<void> => {
    const parsed = parseSession(JSON.stringify(session), now());
    if (!parsed) throw new Error('desktop_session_invalid');
    if (!(await options.safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('desktop_secure_storage_unavailable');
    }
    const encrypted = await options.safeStorage.encryptStringAsync(
      JSON.stringify(parsed),
    );
    await options.fileSystem.mkdir(dirname(options.filePath), {
      recursive: true,
    });
    await options.fileSystem.writeFile(temporaryPath, encrypted, {
      mode: 0o600,
    });
    await options.fileSystem.rename(temporaryPath, options.filePath);
  };

  return {
    save,
    clear,
    async load(): Promise<StoredDesktopSession | null> {
      try {
        if (!(await options.safeStorage.isAsyncEncryptionAvailable())) {
          await clear();
          return null;
        }
        const encrypted = await options.fileSystem.readFile(options.filePath);
        const decrypted =
          await options.safeStorage.decryptStringAsync(encrypted);
        const session = parseSession(decrypted.result, now());
        if (!session) {
          await clear();
          return null;
        }
        if (decrypted.shouldReEncrypt) await save(session);
        return session;
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return null;
        await clear();
        return null;
      }
    },
  };
}
