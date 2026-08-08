import { randomUUID } from 'node:crypto';
import type { TurnResult } from '../shared/turn-result';

export interface AssistantProxy {
  turn(input: { text: string }, signal?: AbortSignal): Promise<TurnResult>;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const FALLBACK_MESSAGE = '抱歉，暂时无法处理。';

/**
 * 桌面壳 → 本地 web 的 turn 代理。
 *
 * 关键设计：Node fetch 默认不带 Origin / sec-fetch-site 头，恰好通过后端
 * isTrustedSameOriginWrite 的无 Origin 分支（sec-fetch-site !== 'cross-site'）；
 * 本地部署模式身份回退 local:owner，无需 cookie。
 * 与 electron 解耦（fetch/baseUrl 注入），单测不启动 Electron。
 */
export function createAssistantProxy(options: {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}): AssistantProxy {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const parseBody = async (response: Response): Promise<unknown> => {
    try {
      return await response.json();
    } catch {
      return null;
    }
  };

  const httpError = (
    status: number,
    body: unknown,
  ): TurnResult & { ok: false } => {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      FALLBACK_MESSAGE;
    return { ok: false, code: 'http', message };
  };

  return {
    async turn(input, signal) {
      const userSignal = signal ?? null;
      const controller = new AbortController();
      const onUserAbort = () => controller.abort();
      if (userSignal) {
        if (userSignal.aborted)
          return { ok: false, code: 'aborted', message: '已取消。' };
        userSignal.addEventListener('abort', onUserAbort, { once: true });
      }
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // 竞速保护：超时/取消由代理自身保证生效，不依赖 fetchImpl 对 signal 的支持
        const abortPromise = new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
        const response = await Promise.race([
          fetchImpl(`${baseUrl}/api/v1/assistant/turn`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              clientMessageId: randomUUID(),
              text: input.text,
            }),
            signal: controller.signal,
          }),
          abortPromise,
        ]);
        const body = await parseBody(response);
        if (!response.ok) return httpError(response.status, body);
        const data = body as {
          action?: string;
          message?: string;
          artifactId?: string;
          panel?: string;
        };
        return {
          ok: true,
          action: data.action ?? 'unknown',
          message: data.message ?? '完成',
          ...(data.artifactId ? { artifactId: data.artifactId } : {}),
          ...(data.panel ? { panel: data.panel } : {}),
        };
      } catch (error) {
        if (userSignal?.aborted)
          return { ok: false, code: 'aborted', message: '已取消。' };
        if (controller.signal.aborted) {
          // 超时与用户取消共用 AbortController；用户取消在上面分支已拦截
          return { ok: false, code: 'timeout', message: '请求超时，请重试。' };
        }
        const cause = (error as { cause?: { code?: string } }).cause;
        if (cause?.code === 'ECONNREFUSED') {
          return {
            ok: false,
            code: 'backend_offline',
            message: '本地服务未启动（先 pnpm dev:all）。',
          };
        }
        return { ok: false, code: 'http', message: '连接中断，请重试。' };
      } finally {
        clearTimeout(timeout);
        if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
      }
    },
  };
}
