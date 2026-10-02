export interface NotebookRequestContext {
  notebookId: string;
  conversationId: string;
}

const SCOPED_ENDPOINT =
  /^\/api\/v1\/(?:chat\/(?:turn|assets|artifacts|artifact-confirmations)(?:\/|$)|canvas(?:\/|$)|learn\/(?:turn|code-runs)(?:\/|$)|assistant\/turn(?:\/|$)|desktop-auth\/authorize(?:\/|$))/;

/** 每次发送时读取本标签 URL；不使用共享 Cookie 或跨导航的全局身份缓存。 */
export function readNotebookRequestContext(): NotebookRequestContext | null {
  if (typeof window === 'undefined') return null;
  const match = /^\/notebook\/([^/]+)\/conversation\/([^/]+)\/?$/.exec(
    window.location.pathname,
  );
  if (!match) return null;
  // 畸形显式路径仍携带上下文，让服务端 fail closed，而不是退回 Cookie。
  return { notebookId: match[1]!, conversationId: match[2]! };
}

export function notebookScopedUrl(
  input: string,
  context = readNotebookRequestContext(),
): string {
  if (!context || !input.startsWith('/') || input.startsWith('//'))
    return input;
  const url = new URL(input, 'https://notebook.invalid');
  if (!SCOPED_ENDPOINT.test(url.pathname)) return input;
  // 已冻结的资源引用保留原上下文；部分/畸形上下文也必须由服务端拒绝。
  if (
    url.searchParams.has('requestNotebookId') ||
    url.searchParams.has('requestConversationId')
  )
    return input;
  url.searchParams.set('requestNotebookId', context.notebookId);
  url.searchParams.set('requestConversationId', context.conversationId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function notebookScopedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  context = readNotebookRequestContext(),
): Promise<Response> {
  return fetch(
    typeof input === 'string' ? notebookScopedUrl(input, context) : input,
    init,
  );
}

/** 只冻结受控读取 URL；资料 Markdown 的同源派生图片同样需要原生请求上下文。 */
export function scopeNotebookResourceUrls<T>(
  value: T,
  context = readNotebookRequestContext(),
): T {
  if (!context) return value;
  if (typeof value === 'string') {
    return value.replace(
      /\/api\/v1\/(?:chat\/(?:assets|artifacts)|canvas)\/[A-Za-z0-9_./%?=&-]+/g,
      (url) => notebookScopedUrl(url, context),
    ) as T;
  }
  if (Array.isArray(value))
    return value.map((item) => scopeNotebookResourceUrls(item, context)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        scopeNotebookResourceUrls(item, context),
      ]),
    ) as T;
  }
  return value;
}
