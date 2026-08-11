const MAX_REQUEST_ID_LENGTH = 128;

/** main 侧把显式 requestId 映射成真正可传给 fetch 的 AbortSignal。 */
export class IpcAbortRegistry {
  private readonly controllers = new Map<string, AbortController>();

  begin(requestId: string): AbortSignal {
    if (
      typeof requestId !== 'string' ||
      requestId.trim().length === 0 ||
      requestId.length > MAX_REQUEST_ID_LENGTH
    ) {
      throw new TypeError('requestId 非法');
    }
    this.controllers.get(requestId)?.abort();
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    return controller.signal;
  }

  finish(requestId: string, signal: AbortSignal): void {
    if (this.controllers.get(requestId)?.signal === signal) {
      this.controllers.delete(requestId);
    }
  }

  cancel(requestId: string): boolean {
    const controller = this.controllers.get(requestId);
    if (!controller) return false;
    this.controllers.delete(requestId);
    controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}
