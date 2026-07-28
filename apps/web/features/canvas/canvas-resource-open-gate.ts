/**
 * 统一打开链的竞态闸门：任何新请求或 Notebook 切换都会取消旧请求，
 * 且只有最新 token 可以提交 UI 状态。
 */
export class CanvasResourceOpenGate {
  #sequence = 0;
  #controller: AbortController | null = null;

  begin(): { readonly token: number; readonly signal: AbortSignal } {
    this.#controller?.abort();
    this.#controller = new AbortController();
    this.#sequence += 1;
    return {
      token: this.#sequence,
      signal: this.#controller.signal,
    };
  }

  isCurrent(token: number): boolean {
    return (
      token === this.#sequence && this.#controller?.signal.aborted === false
    );
  }

  cancel(): void {
    this.#sequence += 1;
    this.#controller?.abort();
    this.#controller = null;
  }
}
