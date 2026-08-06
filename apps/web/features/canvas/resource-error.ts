/**
 * 前端诚实失败的统一错误语义（W03）。
 *
 * 把散落在 Workspace / Studio / Assets / API client 的「失败转空、吞错、只有 message
 * 没有类型」收敛为六种稳定语义：`empty` / `unavailable` / `forbidden` / `not_found` /
 * `failed` / `offline`。组件据此决定文案、可重试性与无障碍 role，UI 不展示原始路径、
 * 堆栈、Provider body 或 Secret。
 *
 * 纯函数模块，无 React/浏览器依赖，便于在 node 环境直接测试。
 */

export type ResourceErrorKind =
  'empty' | 'unavailable' | 'forbidden' | 'not_found' | 'failed' | 'offline';

export interface ResourceError {
  readonly kind: ResourceErrorKind;
  /** 用户可读的稳定文案，不得包含内部路径、堆栈、对象键或 Provider 消息。 */
  readonly message: string;
}

/** Retry 只对可重试错误开放：网络/服务瞬时问题可重试，权限与资源缺失重试无意义。 */
export function isRetryableResourceError(kind: ResourceErrorKind): boolean {
  return kind === 'unavailable' || kind === 'offline' || kind === 'failed';
}

/** HTTP status → 错误语义。401/403 权限、404 资源缺失、503 服务不可用，其余为 failed。 */
export function classifyHttpStatus(status: number): ResourceErrorKind {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 503) return 'unavailable';
  return 'failed';
}

/** 取消不是失败：竞态产生的 AbortError 应被调用方忽略而非展示为错误。 */
export function isAbortError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

/** 网络层失败（fetch 抛出的 TypeError 等）统一判为 offline，携带稳定文案。 */
export function toOfflineError(
  cause: unknown,
  fallback: string,
): ResourceError {
  if (isAbortError(cause)) throw cause;
  return { kind: 'offline', message: fallback };
}

/**
 * 带错误语义的客户端错误：既有 `kind` 可编程分派，又继承 `Error`（`instanceof`
 * 仍成立，兼容既有错误边界与 React error boundary）。
 */
export class ResourceClientError extends Error {
  readonly kind: ResourceErrorKind;

  constructor(kind: ResourceErrorKind, message: string) {
    super(message);
    this.name = 'ResourceClientError';
    this.kind = kind;
  }
}

/** 把未知原因规整为结构化错误：已带 kind 的直接透传，否则统一归为 failed。 */
export function toClientError(
  reason: unknown,
  fallback: string,
): ResourceClientError {
  return reason instanceof ResourceClientError
    ? reason
    : new ResourceClientError('failed', fallback);
}

/**
 * 竞态闸门（latest wins）：同一资源的并发请求只有最新一次能提交状态。
 *
 * 异步请求开始时 `begin()`，完成后调用返回的 `isCurrent()`；返回 false 说明期间
 * 已有更新请求发出，旧结果应被丢弃，避免「过期请求覆盖新状态」（W03 竞态保护）。
 */
export class LatestRequestGuard {
  #sequence = 0;

  begin(): () => boolean {
    const id = ++this.#sequence;
    return () => id === this.#sequence;
  }
}
