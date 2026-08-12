import { afterEach, describe, expect, it } from 'vitest';
import {
  buildFakeMineruZip,
  parseStoredZipEntries,
  startMineruFakeServer,
  type MineruFakeServer,
} from './mineru-fake-server';

/* 本文件是 fake MinerU 服务自身的自测：fake 必须忠实复刻 MinerU 3.4.4
   fast_api 的三步协议（POST /tasks → GET /tasks/{id} → GET /tasks/{id}/result），
   否则后续 mineru-client 的错误矩阵测试会基于错误的协议假设通过。 */

const servers: MineruFakeServer[] = [];

async function start(options?: Parameters<typeof startMineruFakeServer>[0]) {
  const server = await startMineruFakeServer(options);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function multipartForm(
  files: { fieldName: string; filename: string; bytes: Uint8Array }[],
  fields: Record<string, string> = {},
): { body: Uint8Array; contentType: string } {
  const boundary = '----mineru-fake-boundary-7d3f';
  const chunks: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
  }
  for (const file of files) {
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
  }
  const head = new TextEncoder().encode(chunks.join(''));
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(
    head.byteLength +
      files.reduce((n, f) => n + f.bytes.byteLength, 0) +
      tail.byteLength,
  );
  body.set(head, 0);
  let offset = head.byteLength;
  for (const file of files) {
    body.set(file.bytes, offset);
    offset += file.bytes.byteLength;
  }
  body.set(tail, offset);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

const SAMPLE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const DEFAULT_ZIP_ENTRIES = [
  {
    name: 'syllabus/office/syllabus.md',
    bytes: new TextEncoder().encode('# 课程大纲\n'),
  },
  {
    name: 'syllabus/office/syllabus_content_list_v2.json',
    bytes: new TextEncoder().encode('[]'),
  },
  {
    name: 'syllabus/office/images/img_0.png',
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  },
];

async function waitUntilCompleted(
  server: MineruFakeServer,
  taskId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const payload = (await (
      await fetch(`${server.baseUrl}/tasks/${taskId}`)
    ).json()) as { status: string };
    if (payload.status === 'completed') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('fake MinerU task did not complete');
}

describe('fake MinerU 服务（协议自测）', () => {
  it('POST /tasks 返回 202 与 task_id/status/status_url/result_url', async () => {
    const server = await start();
    const { body, contentType } = multipartForm(
      [{ fieldName: 'files', filename: 'syllabus.pdf', bytes: SAMPLE_PDF }],
      { backend: 'auto' },
    );
    const res = await fetch(`${server.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    expect(res.status).toBe(202);
    const payload = (await res.json()) as Record<string, unknown>;
    expect(payload.task_id).toEqual(expect.any(String));
    expect(payload.status).toBe('pending');
    expect(payload.status_url).toContain('/tasks/');
    expect(payload.result_url).toContain('/result');
  });

  it('解析 multipart：记录字段与文件字节（客户端提交参数断言依据）', async () => {
    const server = await start();
    const { body, contentType } = multipartForm(
      [{ fieldName: 'files', filename: 'syllabus.docx', bytes: SAMPLE_PDF }],
      { backend: 'auto', formula_enable: 'true' },
    );
    await fetch(`${server.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

    expect(server.submissions).toHaveLength(1);
    expect(server.submissions[0]!.fields.get('backend')).toBe('auto');
    expect(server.submissions[0]!.fields.get('formula_enable')).toBe('true');
    expect(server.submissions[0]!.files[0]!).toMatchObject({
      fieldName: 'files',
      filename: 'syllabus.docx',
    });
    expect(server.submissions[0]!.files[0]!.bytes).toEqual(SAMPLE_PDF);
  });

  it('状态轮询：从 pending 走到 completed，携带时间字段', async () => {
    const server = await start({ readyAfterMs: 30 });
    const { body, contentType } = multipartForm([
      { fieldName: 'files', filename: 'syllabus.pdf', bytes: SAMPLE_PDF },
    ]);
    const submitted = (await (
      await fetch(`${server.baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })
    ).json()) as { task_id: string };

    const first = (await (
      await fetch(`${server.baseUrl}/tasks/${submitted.task_id}`)
    ).json()) as Record<string, unknown>;
    expect(first.status).toBe('pending');
    expect(first.started_at).toBeNull();
    expect(first.completed_at).toBeNull();

    await new Promise((r) => setTimeout(r, 60));
    const done = (await (
      await fetch(`${server.baseUrl}/tasks/${submitted.task_id}`)
    ).json()) as Record<string, unknown>;
    expect(done.status).toBe('completed');
    expect(done.started_at).toEqual(expect.any(String));
    expect(done.completed_at).toEqual(expect.any(String));
    expect(done.error).toBeNull();
  });

  it('result 返回默认 zip：md + content_list_v2 + images', async () => {
    const server = await start();
    const { body, contentType } = multipartForm([
      { fieldName: 'files', filename: 'syllabus.pdf', bytes: SAMPLE_PDF },
    ]);
    const submitted = (await (
      await fetch(`${server.baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })
    ).json()) as { task_id: string };

    /* 提交契约恒先返回 pending；等待终态再读取结果，避免 0ms timer 竞态。 */
    await waitUntilCompleted(server, submitted.task_id);

    const res = await fetch(
      `${server.baseUrl}/tasks/${submitted.task_id}/result`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/zip');
    const entries = parseStoredZipEntries(
      new Uint8Array(await res.arrayBuffer()),
    );
    expect(entries.map((e) => e.name)).toEqual(
      DEFAULT_ZIP_ENTRIES.map((e) => e.name),
    );
  });

  it('failAfterMs 模式：轮询到 failed，result 返回 409 与 error', async () => {
    const server = await start({ failAfterMs: 30 });
    const { body, contentType } = multipartForm([
      { fieldName: 'files', filename: 'syllabus.pdf', bytes: SAMPLE_PDF },
    ]);
    const submitted = (await (
      await fetch(`${server.baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })
    ).json()) as { task_id: string };

    await new Promise((r) => setTimeout(r, 60));
    const done = (await (
      await fetch(`${server.baseUrl}/tasks/${submitted.task_id}`)
    ).json()) as Record<string, unknown>;
    expect(done.status).toBe('failed');
    expect(done.error).toEqual(expect.any(String));

    const res = await fetch(
      `${server.baseUrl}/tasks/${submitted.task_id}/result`,
    );
    expect(res.status).toBe(409);
  });

  it('未完成时取 result 返回 202（not ready）', async () => {
    const server = await start({ readyAfterMs: 200 });
    const { body, contentType } = multipartForm([
      { fieldName: 'files', filename: 'syllabus.pdf', bytes: SAMPLE_PDF },
    ]);
    const submitted = (await (
      await fetch(`${server.baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })
    ).json()) as { task_id: string };

    const res = await fetch(
      `${server.baseUrl}/tasks/${submitted.task_id}/result`,
    );
    expect(res.status).toBe(202);
  });

  it('未知 task_id 返回 404', async () => {
    const server = await start();
    const res = await fetch(
      `${server.baseUrl}/tasks/00000000-0000-4000-8000-000000000000`,
    );
    expect(res.status).toBe(404);
  });

  it('failOnSubmit 模式：提交即 500（服务不可用）', async () => {
    const server = await start({ failOnSubmit: true });
    const { body, contentType } = multipartForm([
      { fieldName: 'files', filename: 'syllabus.pdf', bytes: SAMPLE_PDF },
    ]);
    const res = await fetch(`${server.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
    expect(res.status).toBe(500);
  });

  it('hang 模式：请求挂起不返回（客户端超时测试场景）', async () => {
    const server = await start({ hang: true });
    const { body, contentType } = multipartForm([
      { fieldName: 'files', filename: 'syllabus.pdf', bytes: SAMPLE_PDF },
    ]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300);
    try {
      await expect(
        fetch(`${server.baseUrl}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    } finally {
      clearTimeout(timer);
    }
  });

  it('corruptZip 模式：result 返回损坏字节（结果校验场景）', async () => {
    const server = await start({ corruptZip: true });
    const { body, contentType } = multipartForm([
      { fieldName: 'files', filename: 'syllabus.pdf', bytes: SAMPLE_PDF },
    ]);
    const submitted = (await (
      await fetch(`${server.baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })
    ).json()) as { task_id: string };

    await waitUntilCompleted(server, submitted.task_id);

    const res = await fetch(
      `${server.baseUrl}/tasks/${submitted.task_id}/result`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('PK');
  });

  it('traversalEntries 模式：zip 含 ../ 路径穿越条目', async () => {
    const server = await start({ traversalEntries: true });
    const { body, contentType } = multipartForm([
      { fieldName: 'files', filename: 'syllabus.pdf', bytes: SAMPLE_PDF },
    ]);
    const submitted = (await (
      await fetch(`${server.baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })
    ).json()) as { task_id: string };

    await waitUntilCompleted(server, submitted.task_id);

    const res = await fetch(
      `${server.baseUrl}/tasks/${submitted.task_id}/result`,
    );
    const entries = parseStoredZipEntries(
      new Uint8Array(await res.arrayBuffer()),
    );
    expect(entries.some((e) => e.name.includes('..'))).toBe(true);
  });

  it('customZipEntries 可注入自定义条目（解包炸弹/超大文件场景）', async () => {
    const huge = new Uint8Array(8 * 1024 * 1024);
    const server = await start({
      customZipEntries: [
        { name: 'bomb/office/bomb.md', bytes: huge },
        { name: 'bomb/office/images/img_0.png', bytes: new Uint8Array(0) },
      ],
    });
    const { body, contentType } = multipartForm([
      { fieldName: 'files', filename: 'bomb.pdf', bytes: SAMPLE_PDF },
    ]);
    const submitted = (await (
      await fetch(`${server.baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      })
    ).json()) as { task_id: string };

    await waitUntilCompleted(server, submitted.task_id);

    const res = await fetch(
      `${server.baseUrl}/tasks/${submitted.task_id}/result`,
    );
    const entries = parseStoredZipEntries(
      new Uint8Array(await res.arrayBuffer()),
    );
    expect(entries.find((e) => e.name.endsWith('.md'))?.bytes.byteLength).toBe(
      huge.byteLength,
    );
  });

  it('GET /health 返回 200 healthy', async () => {
    const server = await start();
    const res = await fetch(`${server.baseUrl}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      status: 'healthy',
    });
  });

  it('zip 构建器生成合法 store zip，可被自身解析器读回', () => {
    const zip = buildFakeMineruZip(DEFAULT_ZIP_ENTRIES);
    expect(new TextDecoder().decode(zip.subarray(0, 2))).toBe('PK');
    const entries = parseStoredZipEntries(zip);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.name).toBe('syllabus/office/syllabus.md');
    expect(new TextDecoder().decode(entries[0]!.bytes)).toBe('# 课程大纲\n');
  });
});
