const MAX_REQUEST_ID_LENGTH = 128;

/** main 侧把显式 requestId 映射成真正可传给 fetch 的 AbortSignal。 */
export class IpcAbortRegistry {
  private readonly controllers = new Map<
    string,
    { controller: AbortController; ownerId?: number }
  >();

  begin(requestId: string, ownerId?: number): AbortSignal {
    if (
      typeof requestId !== 'string' ||
      requestId.trim().length === 0 ||
      requestId.length > MAX_REQUEST_ID_LENGTH
    ) {
      throw new TypeError('requestId 非法');
    }
    this.controllers.get(requestId)?.controller.abort();
    const controller = new AbortController();
    this.controllers.set(requestId, { controller, ownerId });
    return controller.signal;
  }

  finish(requestId: string, signal: AbortSignal): void {
    if (this.controllers.get(requestId)?.controller.signal === signal) {
      this.controllers.delete(requestId);
    }
  }

  cancel(requestId: string, ownerId?: number): boolean {
    const entry = this.controllers.get(requestId);
    if (!entry || (ownerId !== undefined && entry.ownerId !== ownerId))
      return false;
    this.controllers.delete(requestId);
    entry.controller.abort();
    return true;
  }

  cancelOwner(ownerId: number): number {
    let cancelled = 0;
    for (const [requestId, entry] of this.controllers) {
      if (entry.ownerId !== ownerId) continue;
      this.controllers.delete(requestId);
      entry.controller.abort();
      cancelled += 1;
    }
    return cancelled;
  }

  cancelAll(): void {
    for (const { controller } of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}
