/**
 * 统一打开链的竞态闸门：任何新请求或 Notebook 切换都会取消旧请求，
 * 且只有最新 token 可以提交 UI 状态。
 */
export class CanvasResourceOpenGate {
  #sequence = 0;
  #controller: AbortController | null = null;

  begin(scopeKey: string): {
    readonly token: number;
    readonly scopeKey: string;
    readonly signal: AbortSignal;
  } {
    this.#controller?.abort();
    this.#controller = new AbortController();
    this.#sequence += 1;
    return {
      token: this.#sequence,
      scopeKey,
      signal: this.#controller.signal,
    };
  }

  isCurrent(
    request: { readonly token: number; readonly scopeKey: string },
    currentScopeKey: string,
  ): boolean {
    return (
      request.token === this.#sequence &&
      request.scopeKey === currentScopeKey &&
      this.#controller?.signal.aborted === false
    );
  }

  cancel(): void {
    this.#sequence += 1;
    this.#controller?.abort();
    this.#controller = null;
  }
}
