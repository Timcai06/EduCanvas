/**
 * MinerU 转换服务客户端（ADR-0026 决定 2）。
 *
 * Worker 通过本模块调用独立部署的 mineru-api，遵守三步协议：
 * submit（POST /tasks）→ wait（GET /tasks/{id} 轮询）→ fetchResult
 * （GET /tasks/{id}/result 下载 zip）。Node 进程内不加载 Python 模型，
 * 也不创建第二套任务账本。
 *
 * 失败全部映射为带稳定码的 `MineruClientError`；错误消息只含稳定码，
 * 不携带供应商原始错误体、主机路径或密钥（secret containment）。
 *
 * 确定性失败（不可达、被拒绝、结果损坏、任务失败）由调用方直接写终态；
 * 瞬时失败（单次请求超时）允许调用方退避重试。
 */

/** 单次 HTTP 请求的默认超时（毫秒）。上传/下载大文件时调用方可覆盖。 */
export const DEFAULT_MINERU_REQUEST_TIMEOUT_MS = 60_000;

/** 轮询总时长上限（ADR-0026：有界轮询，超限降级，不能无限等）。 */
export const MINERU_POLL_TIMEOUT_MS = 15 * 60 * 1000;
/** 轮询初始间隔。 */
export const MINERU_POLL_INTERVAL_MS = 1_000;
/** 轮询间隔上限（指数退避封顶）。 */
export const MINERU_POLL_MAX_INTERVAL_MS = 10_000;

/**
 * 从环境变量读取 MinerU 服务配置（ADR-0026 决定 2：未配置时允许降级）。
 *
 * `MINERU_BASE_URL` 缺失/空白 = 未配置，返回 null，编排层直接走纯文本降级；
 * 非 http(s) 的值视为配置错误，同样返回 null（宁可降级也不带错误地址打请求）。
 */
export function loadMineruConfig(
  env: Record<string, string | undefined>,
): { baseUrl: string } | null {
  const baseUrl = env.MINERU_BASE_URL?.trim();
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) return null;
  return { baseUrl };
}

/**
 * 稳定失败码。它们可能落进 asset_processing_jobs.failure_code 或结构化日志，
 * 因此只能追加、不能改写含义。
 */
export const mineruClientFailureCodes = [
  /** 连接层失败：DNS、连接拒绝、连接断开（确定性失败）。 */
  'mineru_unreachable',
  /** 单次 HTTP 请求超时（瞬时失败，允许退避重试）。 */
  'mineru_request_timeout',
  /** 提交被服务端拒绝（非 202，如 4xx/5xx）。 */
  'mineru_submit_rejected',
  /** 响应结构损坏（非 JSON、缺 task_id/status_url/result_url）。 */
  'mineru_invalid_response',
  /** 任务终态 failed（服务端报告转换失败）。 */
  'mineru_task_failed',
  /** 轮询总时长超过上限（15 分钟）。 */
  'mineru_task_timeout',
  /** result 下载失败（非 200/202/409 之外的状态）。 */
  'mineru_result_download_failed',
  /** 结果内容损坏（非 zip、zip 解析失败、缺 md、内容超界）。 */
  'mineru_result_invalid',
] as const;

export type MineruClientFailureCode = (typeof mineruClientFailureCodes)[number];

export class MineruClientError extends Error {
  override readonly name = 'MineruClientError';

  constructor(
    readonly code: MineruClientFailureCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 把 fetch 抛出的异常映射为稳定失败码。
 *
 * 调用方主动取消（externalSignal.aborted）时原样传播 AbortError——
 * 那是调用方的决定，不是转换失败，不能落进错误账本。
 */
export function classifyMineruFetchError(
  cause: unknown,
  externalSignal?: AbortSignal,
): MineruClientError {
  if (externalSignal?.aborted) {
    throw new DOMException('aborted by caller', 'AbortError');
  }
  if (cause instanceof DOMException && cause.name === 'TimeoutError') {
    return new MineruClientError('mineru_request_timeout', { cause });
  }
  /* 其余（含 fetch failed/ECONNREFUSED 等 TypeError）归为不可达。 */
  return new MineruClientError('mineru_unreachable', { cause });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutSignal])
    : timeoutSignal;
  try {
    return await fetch(url, { ...init, signal });
  } catch (cause) {
    throw classifyMineruFetchError(cause, externalSignal);
  }
}

export interface MineruSubmitParams {
  baseUrl: string;
  /** 提交的文件名（MinerU 按文件名生成派生目录与 md 名）。 */
  filename: string;
  fileBytes: Uint8Array;
  /** 上传时的 Content-Type（detectAssetFile 的归一化 MIME）。 */
  contentType: string;
  options?: {
    formulaEnable?: boolean;
    tableEnable?: boolean;
    langList?: string[];
  };
  timeoutMs?: number;
  /** 调用方取消信号（主动取消原样传播 AbortError）。 */
  signal?: AbortSignal;
}

export interface MineruSubmittedTask {
  taskId: string;
  status: 'pending';
  statusUrl: string;
  resultUrl: string;
  /** 排队时前方的任务数（背压观测）。 */
  queuedAhead: number;
}

/**
 * 校验提交响应结构。缺关键字段 = 响应损坏，不静默成功。
 */
export function validateSubmitResponse(payload: unknown): MineruSubmittedTask {
  if (
    !isRecord(payload) ||
    typeof payload.task_id !== 'string' ||
    payload.task_id.length === 0 ||
    typeof payload.status_url !== 'string' ||
    typeof payload.result_url !== 'string'
  ) {
    throw new MineruClientError('mineru_invalid_response');
  }
  return {
    taskId: payload.task_id,
    status: 'pending',
    statusUrl: payload.status_url,
    resultUrl: payload.result_url,
    queuedAhead:
      typeof payload.queued_ahead === 'number' ? payload.queued_ahead : 0,
  };
}

/**
 * 提交转换任务（三步协议第一步）。
 *
 * 统一提交 hybrid-engine + zip 格式（ADR-0026 决定 2/3：md + content_list +
 * images 一次取回）；office 文档任意 backend 都先走 office 解析器，
 * 无需按文件类型切换提交参数。
 */
export async function submitMineruTask(
  params: MineruSubmitParams,
): Promise<MineruSubmittedTask> {
  const form = new FormData();
  form.append(
    'files',
    /* 拷贝收窄为 Uint8Array<ArrayBuffer>：TS 5.7 后 BlobPart 不接受
       ArrayBufferLike 视图（如 SharedArrayBuffer 背景的调用方字节）。 */
    new Blob([new Uint8Array(params.fileBytes)], { type: params.contentType }),
    params.filename,
  );
  form.append('backend', 'hybrid-engine');
  form.append('parse_method', 'auto');
  form.append('effort', 'medium');
  form.append('formula_enable', String(params.options?.formulaEnable ?? false));
  form.append('table_enable', String(params.options?.tableEnable ?? false));
  form.append('return_md', 'true');
  form.append('return_content_list', 'true');
  form.append('return_images', 'true');
  form.append('response_format_zip', 'true');
  for (const lang of params.options?.langList ?? ['ch']) {
    form.append('lang_list', lang);
  }

  const response = await fetchWithTimeout(
    `${params.baseUrl}/tasks`,
    { method: 'POST', body: form },
    params.timeoutMs ?? DEFAULT_MINERU_REQUEST_TIMEOUT_MS,
    params.signal,
  );
  if (response.status !== 202) {
    /* 不读响应正文：供应商错误体不得进入日志或错误码。 */
    throw new MineruClientError('mineru_submit_rejected', {
      cause: { status: response.status },
    });
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new MineruClientError('mineru_invalid_response', { cause });
  }
  return validateSubmitResponse(payload);
}

/* ------------------------------------------------------------------ */
/* 轮询（三步协议第二步）                                                */
/* ------------------------------------------------------------------ */

export interface MineruPollParams {
  taskId: string;
  /** 提交响应返回的 status_url（绝对地址，来自服务端）。 */
  statusUrl: string;
  /** 首次轮询间隔；之后指数退避到 maxPollIntervalMs。 */
  pollIntervalMs?: number;
  /** 轮询总时长上限（默认 15 分钟）。 */
  pollTimeoutMs?: number;
  maxPollIntervalMs?: number;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
}

export type MineruTaskOutcome = {
  taskId: string;
  status: 'completed';
};

/**
 * 校验状态响应结构。缺 status 字段 = 响应损坏。
 */
export function validateStatusResponse(payload: unknown): { status: string } {
  if (!isRecord(payload) || typeof payload.status !== 'string') {
    throw new MineruClientError('mineru_invalid_response');
  }
  return { status: payload.status };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 轮询任务直到终态（三步协议第二步）。
 *
 * - completed → 返回；failed → `mineru_task_failed`；404（任务在服务端丢失）
 *   同样归为任务失败。
 * - 单次请求超时与 5xx 视为瞬时，退避后继续轮询，不丢弃仍在服务端运行的任务。
 * - 总时长超过 pollTimeoutMs → `mineru_task_timeout`（确定性失败，调用方降级）。
 * - 调用方取消原样传播 AbortError。
 */
export async function waitForMineruTask(
  params: MineruPollParams,
): Promise<MineruTaskOutcome> {
  const deadline =
    Date.now() + (params.pollTimeoutMs ?? MINERU_POLL_TIMEOUT_MS);
  let intervalMs = params.pollIntervalMs ?? MINERU_POLL_INTERVAL_MS;
  const maxIntervalMs = params.maxPollIntervalMs ?? MINERU_POLL_MAX_INTERVAL_MS;
  const requestTimeoutMs =
    params.requestTimeoutMs ?? DEFAULT_MINERU_REQUEST_TIMEOUT_MS;
  let attempts = 0;

  for (;;) {
    attempts += 1;
    if (params.signal?.aborted) {
      throw new DOMException('aborted by caller', 'AbortError');
    }
    if (Date.now() >= deadline) {
      throw new MineruClientError('mineru_task_timeout', {
        cause: { taskId: params.taskId, attempts },
      });
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        params.statusUrl,
        { method: 'GET' },
        requestTimeoutMs,
        params.signal,
      );
    } catch (cause) {
      /* 单次请求超时：任务仍在服务端，退避后继续轮询。 */
      if (
        cause instanceof MineruClientError &&
        cause.code === 'mineru_request_timeout'
      ) {
        await sleep(intervalMs);
        intervalMs = Math.min(intervalMs * 2, maxIntervalMs);
        continue;
      }
      throw cause;
    }

    if (response.status === 404) {
      /* 任务在服务端丢失（结果保留 24h 内不该发生），等价于任务失败。 */
      throw new MineruClientError('mineru_task_failed', {
        cause: { taskId: params.taskId, status: 404 },
      });
    }
    if (response.status !== 200) {
      /* 5xx：服务端瞬时故障，退避后继续轮询。 */
      await sleep(intervalMs);
      intervalMs = Math.min(intervalMs * 2, maxIntervalMs);
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new MineruClientError('mineru_invalid_response', { cause });
    }
    const { status } = validateStatusResponse(payload);
    if (status === 'completed') {
      return { taskId: params.taskId, status: 'completed' };
    }
    if (status === 'failed') {
      /* 不带服务端 error 字段内容（secret containment）。 */
      throw new MineruClientError('mineru_task_failed', {
        cause: { taskId: params.taskId },
      });
    }
    /* pending/processing/未知状态：退避后继续。 */
    await sleep(intervalMs);
    intervalMs = Math.min(intervalMs * 2, maxIntervalMs);
  }
}

/* ------------------------------------------------------------------ */
/* 取结果（三步协议第三步）                                              */
/* ------------------------------------------------------------------ */

/** result 响应体默认大小上限（zip 含 md+content_list+images）。 */
export const MINERU_RESULT_MAX_BYTES = 512 * 1024 * 1024;

export interface MineruFetchResultParams {
  taskId: string;
  /** 提交响应返回的 result_url（绝对地址，来自服务端）。 */
  resultUrl: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 结果响应体大小上限，超限 = 结果损坏。 */
  maxResultBytes?: number;
}

/**
 * 校验字节是 zip 容器（local header 或空 zip 的 EOCD）。
 */
export function assertMineruZipBytes(bytes: Uint8Array): void {
  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 && // P
    bytes[1] === 0x4b && // K
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || // local file header
      (bytes[2] === 0x05 && bytes[3] === 0x06)); // empty archive EOCD
  if (!isZip) throw new MineruClientError('mineru_result_invalid');
}

/**
 * 下载任务结果 zip（三步协议第三步）。
 *
 * 调用方先 waitForMineruTask 确认终态，这里只处理 completed 后的下载；
 * 202/409/404 视为下载失败。响应体大小有界，防止供应商返回异常大包。
 */
export async function fetchMineruResult(
  params: MineruFetchResultParams,
): Promise<Uint8Array> {
  const response = await fetchWithTimeout(
    params.resultUrl,
    { method: 'GET' },
    params.timeoutMs ?? DEFAULT_MINERU_REQUEST_TIMEOUT_MS,
    params.signal,
  );
  if (response.status !== 200) {
    /* 不读响应正文：供应商错误体不得进入日志或错误码。 */
    throw new MineruClientError('mineru_result_download_failed', {
      cause: { taskId: params.taskId, status: response.status },
    });
  }

  const maxBytes = params.maxResultBytes ?? MINERU_RESULT_MAX_BYTES;
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    throw new MineruClientError('mineru_result_invalid', {
      cause: { taskId: params.taskId, declaredBytes: declared },
    });
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    throw new MineruClientError('mineru_result_download_failed', {
      cause: { taskId: params.taskId, cause },
    });
  }
  if (bytes.byteLength > maxBytes) {
    throw new MineruClientError('mineru_result_invalid', {
      cause: { taskId: params.taskId, actualBytes: bytes.byteLength },
    });
  }
  assertMineruZipBytes(bytes);
  return bytes;
}
