import {
  validateCanvasResource,
  type CanvasResource,
} from '@educanvas/canvas-protocol';

const RESOURCES_ENDPOINT = '/api/v1/canvas/resources';

export type CanvasResourceClientErrorKind = 'denied' | 'unavailable' | 'failed';

export interface CanvasResourceClientError {
  readonly kind: CanvasResourceClientErrorKind;
  readonly message: string;
}

/**
 * 统一资源描述客户端：只读取 CanvasResource 元数据（不含内容本体）。
 * 内容仍通过既有的 preview/file/Artifact detail 端点读取。
 *
 * 安全边界：
 * - 不接受调用方传入 Notebook ID；归属由服务端从 cookie 解析。
 * - 不信任浏览器自行构造的 CanvasResource；所有响应经协议校验。
 * - 不把服务端原始 body、堆栈或内部错误对象传给 UI。
 */
export async function fetchCanvasResource(
  resourceKind: 'source' | 'artifact',
  resourceId: string,
  options: { signal?: AbortSignal } = {},
): Promise<CanvasResource> {
  const url = `${RESOURCES_ENDPOINT}/${encodeURIComponent(resourceKind)}/${encodeURIComponent(resourceId)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'AbortError'
    ) {
      throw error;
    }
    throw canvasResourceClientError(
      'failed',
      '无法连接到服务器，请检查网络后重试。',
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw canvasResourceClientError('denied', '没有权限访问这个资源。');
    }
    if (response.status === 404 || response.status === 422) {
      throw canvasResourceClientError(
        'unavailable',
        '这个资源不存在或无法加载。',
      );
    }
    if (response.status === 503) {
      throw canvasResourceClientError(
        'unavailable',
        '服务暂时不可用，请稍后重试。',
      );
    }
    throw canvasResourceClientError('failed', '请求失败，请稍后重试。');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw canvasResourceClientError('failed', '服务器响应格式不正确。');
  }

  const record = body as Record<string, unknown>;
  if (!record || typeof record !== 'object' || !('resource' in record)) {
    throw canvasResourceClientError('unavailable', '服务器未返回有效资源。');
  }

  const validation = validateCanvasResource(record.resource);
  if (!validation.ok) {
    throw canvasResourceClientError(
      'unavailable',
      '资源描述不兼容，请更新后重试。',
    );
  }

  return validation.resource;
}

function canvasResourceClientError(
  kind: CanvasResourceClientErrorKind,
  message: string,
): CanvasResourceClientError {
  return { kind, message };
}
