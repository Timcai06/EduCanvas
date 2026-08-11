import { afterEach, describe, expect, it } from 'vitest';
import {
  MineruClientError,
  assertMineruZipBytes,
  classifyMineruFetchError,
  fetchMineruResult,
  mineruClientFailureCodes,
  submitMineruTask,
  validateStatusResponse,
  validateSubmitResponse,
  waitForMineruTask,
} from './mineru-client';
import {
  startMineruFakeServer,
  type MineruFakeServer,
} from './mineru-fake-server';

const servers: MineruFakeServer[] = [];

async function start(options?: Parameters<typeof startMineruFakeServer>[0]) {
  const server = await startMineruFakeServer(options);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const SAMPLE_DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

describe('submitMineruTask（三步协议第一步）', () => {
  it('成功提交返回 taskId/statusUrl/resultUrl，提交参数与真实 MinerU 表单一致', async () => {
    const server = await start();
    const submitted = await submitMineruTask({
      baseUrl: server.baseUrl,
      filename: 'syllabus.docx',
      fileBytes: SAMPLE_DOCX,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml',
      options: { formulaEnable: true, tableEnable: true },
    });

    expect(submitted.taskId).toEqual(expect.any(String));
    expect(submitted.status).toBe('pending');
    expect(submitted.statusUrl).toContain(`/tasks/${submitted.taskId}`);
    expect(submitted.resultUrl).toContain(`/tasks/${submitted.taskId}/result`);

    expect(server.submissions).toHaveLength(1);
    const submission = server.submissions[0]!;
    expect(submission.files[0]).toMatchObject({
      fieldName: 'files',
      filename: 'syllabus.docx',
    });
    expect(submission.files[0]!.bytes).toEqual(SAMPLE_DOCX);
    /* 字段与 MinerU ParseRequestOptions 对应：统一 hybrid-engine、返回
       md+content_list+images、zip 格式。 */
    expect(submission.fields.get('backend')).toBe('hybrid-engine');
    expect(submission.fields.get('formula_enable')).toBe('true');
    expect(submission.fields.get('table_enable')).toBe('true');
    expect(submission.fields.get('return_md')).toBe('true');
    expect(submission.fields.get('return_content_list')).toBe('true');
    expect(submission.fields.get('return_images')).toBe('true');
    expect(submission.fields.get('response_format_zip')).toBe('true');
  });

  it('服务不可达（连接拒绝）映射为 mineru_unreachable', async () => {
    const server = await start();
    await server.close(); /* 端口释放后连接必然被拒绝 */
    const err = await submitMineruTask({
      baseUrl: server.baseUrl,
      filename: 'a.pdf',
      fileBytes: SAMPLE_DOCX,
      contentType: 'application/pdf',
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe('mineru_unreachable');
  });

  it('单次请求超时映射为 mineru_request_timeout', async () => {
    const server = await start({ hang: true });
    const err = await submitMineruTask({
      baseUrl: server.baseUrl,
      filename: 'a.pdf',
      fileBytes: SAMPLE_DOCX,
      contentType: 'application/pdf',
      timeoutMs: 150,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe('mineru_request_timeout');
  });

  it('提交被拒绝（500）映射为 mineru_submit_rejected', async () => {
    const server = await start({ failOnSubmit: true });
    const err = await submitMineruTask({
      baseUrl: server.baseUrl,
      filename: 'a.pdf',
      fileBytes: SAMPLE_DOCX,
      contentType: 'application/pdf',
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe('mineru_submit_rejected');
  });

  it('202 但响应结构损坏（缺 task_id）映射为 mineru_invalid_response', async () => {
    const server = await start({ invalidSubmitResponse: true });
    const err = await submitMineruTask({
      baseUrl: server.baseUrl,
      filename: 'a.pdf',
      fileBytes: SAMPLE_DOCX,
      contentType: 'application/pdf',
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe('mineru_invalid_response');
  });

  it('调用方主动取消时原样传播 AbortError，不伪装成失败码', async () => {
    const server = await start({ hang: true });
    const controller = new AbortController();
    const pending = submitMineruTask({
      baseUrl: server.baseUrl,
      filename: 'a.pdf',
      fileBytes: SAMPLE_DOCX,
      contentType: 'application/pdf',
      signal: controller.signal,
    });
    controller.abort();
    const err = await pending.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
    expect(err).not.toBeInstanceOf(MineruClientError);
  });
});

describe('waitForMineruTask（三步协议第二步：轮询）', () => {
  async function submitAndWait(
    server: MineruFakeServer,
    waitParams: Omit<
      Parameters<typeof waitForMineruTask>[0],
      'statusUrl' | 'taskId'
    > = {},
  ) {
    const submitted = await submitMineruTask({
      baseUrl: server.baseUrl,
      filename: 'syllabus.pdf',
      fileBytes: SAMPLE_DOCX,
      contentType: 'application/pdf',
    });
    return waitForMineruTask({
      taskId: submitted.taskId,
      statusUrl: submitted.statusUrl,
      ...waitParams,
    });
  }

  it('立即完成的任务一次轮询即返回 completed', async () => {
    const server = await start();
    const outcome = await submitAndWait(server);

    expect(outcome).toEqual({
      taskId: expect.any(String),
      status: 'completed',
    });
    expect(server.statusRequestCount).toBe(1);
  });

  it('延迟完成的任务多次轮询直到 completed', async () => {
    const server = await start({ readyAfterMs: 80 });
    const outcome = await submitAndWait(server, {
      pollIntervalMs: 20,
      pollTimeoutMs: 5_000,
    });

    expect(outcome.status).toBe('completed');
    expect(server.statusRequestCount).toBeGreaterThan(1);
  });

  it('任务失败（终态 failed）映射为 mineru_task_failed', async () => {
    const server = await start({ failAfterMs: 40 });
    const err = await submitAndWait(server, {
      pollIntervalMs: 20,
      pollTimeoutMs: 5_000,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe('mineru_task_failed');
  });

  it('轮询总时长超限映射为 mineru_task_timeout', async () => {
    const server = await start({ readyAfterMs: 2_000 });
    const err = await submitAndWait(server, {
      pollIntervalMs: 20,
      pollTimeoutMs: 150,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe('mineru_task_timeout');
  });

  it('任务在服务端丢失（404）映射为 mineru_task_failed', async () => {
    const server = await start();
    const err = await waitForMineruTask({
      taskId: '00000000-0000-4000-8000-000000000000',
      statusUrl: `${server.baseUrl}/tasks/00000000-0000-4000-8000-000000000000`,
      pollTimeoutMs: 1_000,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe('mineru_task_failed');
  });

  it('轮询中调用方取消原样传播 AbortError', async () => {
    const server = await start({ hangStatus: true });
    const controller = new AbortController();
    const pending = submitAndWait(server, { signal: controller.signal });
    controller.abort();
    const err = await pending.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('AbortError');
  });
});

describe('fetchMineruResult（三步协议第三步：下载结果）', () => {
  async function submitAndComplete(server: MineruFakeServer) {
    const submitted = await submitMineruTask({
      baseUrl: server.baseUrl,
      filename: 'syllabus.pdf',
      fileBytes: SAMPLE_DOCX,
      contentType: 'application/pdf',
    });
    await waitForMineruTask({
      taskId: submitted.taskId,
      statusUrl: submitted.statusUrl,
    });
    return submitted;
  }

  it('成功下载 zip 结果，返回合法 zip 字节', async () => {
    const server = await start();
    const submitted = await submitAndComplete(server);

    const zip = await fetchMineruResult({
      taskId: submitted.taskId,
      resultUrl: submitted.resultUrl,
    });
    expect(new TextDecoder().decode(zip.subarray(0, 2))).toBe('PK');
  });

  it('结果损坏（非 zip 字节）映射为 mineru_result_invalid', async () => {
    const server = await start({ corruptZip: true });
    const submitted = await submitAndComplete(server);

    const err = await fetchMineruResult({
      taskId: submitted.taskId,
      resultUrl: submitted.resultUrl,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe('mineru_result_invalid');
  });

  it('结果未就绪（202）映射为 mineru_result_download_failed', async () => {
    const server = await start({ readyAfterMs: 5_000 });
    const submitted = await submitMineruTask({
      baseUrl: server.baseUrl,
      filename: 'syllabus.pdf',
      fileBytes: SAMPLE_DOCX,
      contentType: 'application/pdf',
    });

    const err = await fetchMineruResult({
      taskId: submitted.taskId,
      resultUrl: submitted.resultUrl,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe(
      'mineru_result_download_failed',
    );
  });

  it('任务失败（409）映射为 mineru_result_download_failed', async () => {
    const server = await start({ failAfterMs: 40 });
    const submitted = await submitMineruTask({
      baseUrl: server.baseUrl,
      filename: 'syllabus.pdf',
      fileBytes: SAMPLE_DOCX,
      contentType: 'application/pdf',
    });
    await new Promise((r) => setTimeout(r, 60));

    const err = await fetchMineruResult({
      taskId: submitted.taskId,
      resultUrl: submitted.resultUrl,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe(
      'mineru_result_download_failed',
    );
  });

  it('任务不存在（404）映射为 mineru_result_download_failed', async () => {
    const server = await start();
    const err = await fetchMineruResult({
      taskId: '00000000-0000-4000-8000-000000000000',
      resultUrl: `${server.baseUrl}/tasks/00000000-0000-4000-8000-000000000000/result`,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe(
      'mineru_result_download_failed',
    );
  });

  it('下载请求超时映射为 mineru_request_timeout', async () => {
    const server = await start({ hangResult: true });
    const submitted = await submitAndComplete(server);

    const err = await fetchMineruResult({
      taskId: submitted.taskId,
      resultUrl: submitted.resultUrl,
      timeoutMs: 150,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MineruClientError);
    expect((err as MineruClientError).code).toBe('mineru_request_timeout');
  });
});

describe('mineru-client 错误分类总表与映射矩阵', () => {
  it('总表完整：8 个稳定码且无新增无删减', () => {
    expect(mineruClientFailureCodes).toEqual([
      'mineru_unreachable',
      'mineru_request_timeout',
      'mineru_submit_rejected',
      'mineru_invalid_response',
      'mineru_task_failed',
      'mineru_task_timeout',
      'mineru_result_download_failed',
      'mineru_result_invalid',
    ]);
  });

  describe('classifyMineruFetchError 矩阵', () => {
    /* 表中每个输入都必须映射到预期稳定码；外部取消一律原样传播。 */
    const matrix: {
      name: string;
      cause: unknown;
      external?: AbortSignal;
      code: string;
    }[] = [
      {
        name: '连接拒绝（fetch failed）',
        cause: new TypeError('fetch failed', {
          cause: new Error('connect ECONNREFUSED'),
        }),
        code: 'mineru_unreachable',
      },
      {
        name: 'DNS 解析失败',
        cause: new TypeError('fetch failed', {
          cause: new Error('getaddrinfo ENOTFOUND'),
        }),
        code: 'mineru_unreachable',
      },
      {
        name: '连接断开',
        cause: new TypeError('fetch failed', {
          cause: new Error('socket hang up'),
        }),
        code: 'mineru_unreachable',
      },
      {
        name: '请求超时（TimeoutError）',
        cause: new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError',
        ),
        code: 'mineru_request_timeout',
      },
    ];

    it.each(matrix)('$name → $code', ({ cause, external, code }) => {
      const err = classifyMineruFetchError(cause, external);
      expect(err).toBeInstanceOf(MineruClientError);
      expect(err.code).toBe(code);
    });

    it('外部 signal 已取消 → 原样抛 AbortError，不映射任何失败码', () => {
      const controller = new AbortController();
      controller.abort();
      expect(() =>
        classifyMineruFetchError(
          new TypeError('fetch failed'),
          controller.signal,
        ),
      ).toThrowError(DOMException);
      expect(() =>
        classifyMineruFetchError(
          new TypeError('fetch failed'),
          controller.signal,
        ),
      ).toThrowError(/aborted/i);
    });
  });

  describe('validateSubmitResponse 矩阵', () => {
    it('完整负载 → 返回规范化结果', () => {
      const parsed = validateSubmitResponse({
        task_id: 't-1',
        status_url: 'http://x/tasks/t-1',
        result_url: 'http://x/tasks/t-1/result',
        queued_ahead: 2,
      });
      expect(parsed).toEqual({
        taskId: 't-1',
        status: 'pending',
        statusUrl: 'http://x/tasks/t-1',
        resultUrl: 'http://x/tasks/t-1/result',
        queuedAhead: 2,
      });
    });

    it('queued_ahead 缺失 → 归 0（背压未知不阻塞）', () => {
      const parsed = validateSubmitResponse({
        task_id: 't-1',
        status_url: 'http://x/tasks/t-1',
        result_url: 'http://x/tasks/t-1/result',
      });
      expect(parsed.queuedAhead).toBe(0);
    });

    it.each([
      ['null', null],
      ['非对象', 'string'],
      ['缺 task_id', { status_url: 'u', result_url: 'r' }],
      ['task_id 非字符串', { task_id: 1, status_url: 'u', result_url: 'r' }],
      ['task_id 为空串', { task_id: '', status_url: 'u', result_url: 'r' }],
      ['缺 status_url', { task_id: 't', result_url: 'r' }],
      ['缺 result_url', { task_id: 't', status_url: 'u' }],
    ])('%s → mineru_invalid_response', (_name, payload) => {
      expect(() => validateSubmitResponse(payload)).toThrowError(
        MineruClientError,
      );
      expect(() => validateSubmitResponse(payload)).toThrowError(
        /mineru_invalid_response/,
      );
    });
  });

  describe('validateStatusResponse 矩阵', () => {
    it('合法状态 → 返回 status', () => {
      expect(validateStatusResponse({ status: 'completed' })).toEqual({
        status: 'completed',
      });
    });

    it.each([
      ['null', null],
      ['非对象', 42],
      ['缺 status', {}],
      ['status 非字符串', { status: 1 }],
    ])('%s → mineru_invalid_response', (_name, payload) => {
      expect(() => validateStatusResponse(payload)).toThrowError(
        MineruClientError,
      );
    });
  });

  describe('assertMineruZipBytes 矩阵', () => {
    const zipLocalHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const emptyZipEocd = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0x00]);

    it.each([
      ['local file header 开头', zipLocalHeader, true],
      ['空 zip EOCD 开头', emptyZipEocd, true],
      ['仅 2 字节 PK', new Uint8Array([0x50, 0x4b]), false],
      ['非 zip 文本', new TextEncoder().encode('not a zip'), false],
      ['空字节', new Uint8Array(0), false],
    ])('%s → %s', (_name, bytes, ok) => {
      if (ok) {
        expect(() => assertMineruZipBytes(bytes)).not.toThrow();
      } else {
        expect(() => assertMineruZipBytes(bytes)).toThrowError(
          MineruClientError,
        );
        expect(() => assertMineruZipBytes(bytes)).toThrowError(
          /mineru_result_invalid/,
        );
      }
    });
  });

  describe('错误消息 secret containment（ADR-0026 决定 6）', () => {
    it('MineruClientError 消息只含稳定码，不携带供应商错误体/路径', () => {
      const err = new MineruClientError('mineru_task_failed', {
        cause: { error: '/home/server/secret-path/traceback.txt' },
      });
      expect(err.message).toBe('mineru_task_failed');
      expect(err.message).not.toContain('/home/');
    });
  });
});
