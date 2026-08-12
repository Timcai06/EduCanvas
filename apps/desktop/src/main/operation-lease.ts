import { randomUUID } from 'node:crypto';

export function createOperationLease(createToken: () => string = randomUUID) {
  let active: { ownerId: number; token: string } | null = null;
  return {
    acquire(ownerId: number): string | null {
      if (active) return null;
      const token = createToken();
      active = { ownerId, token };
      return token;
    },
    holds(ownerId: number, token: string): boolean {
      return active?.ownerId === ownerId && active.token === token;
    },
    release(ownerId: number, token: string): boolean {
      if (!active || active.ownerId !== ownerId || active.token !== token)
        return false;
      active = null;
      return true;
    },
    releaseOwner(ownerId: number): boolean {
      if (!active || active.ownerId !== ownerId) return false;
      active = null;
      return true;
    },
  };
}
