import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

/**
 * fake MinerU 服务 —— 只用于测试（mineru-client 错误矩阵与 CI 故障注入）。
 *
 * 协议逐字段复刻 MinerU 3.4.4 `cli/fast_api.py`（已在部署环境源码核实）：
 * - POST /tasks（multipart，202）→ {task_id, status, backend, file_names,
 *   created_at, started_at, completed_at, error, status_url, result_url, queued_ahead}
 * - GET /tasks/{task_id} → 200 状态负载；未知任务 404 {detail}
 * - GET /tasks/{task_id}/result → 200 application/zip（arcname 结构
 *   `<stem>/office/<stem>.md` + `_content_list_v2.json` + `images/`）；
 *   未就绪 202；失败 409；未知 404
 * - GET /health → 200 {status: "healthy"}
 *
 * 故障注入选项覆盖 ADR-0026 验证 7 需要的场景：挂起（超时）、提交 500、
 * 转换失败、结果损坏、路径穿越、解包炸弹、超大文件。
 */

export interface FakeMineruZipEntry {
  name: string;
  bytes: Uint8Array;
}

export interface MineruFakeServerOptions {
  /** 提交后多少毫秒进入 completed（默认 0，即立即完成）。 */
  readyAfterMs?: number;
  /** 提交后多少毫秒进入 failed（默认不失败）。 */
  failAfterMs?: number;
  /** 提交请求挂起不返回（客户端超时测试）。 */
  hang?: boolean;
  /** 状态轮询请求挂起不返回（轮询取消/超时测试）。 */
  hangStatus?: boolean;
  /** result 下载请求挂起不返回（下载超时测试）。 */
  hangResult?: boolean;
  /** 提交即 500（服务不可用）。 */
  failOnSubmit?: boolean;
  /** 提交返回 202 但响应结构损坏（缺 task_id）。 */
  invalidSubmitResponse?: boolean;
  /** result 返回损坏字节（非 zip 结构）。 */
  corruptZip?: boolean;
  /** zip 内注入含 `..` 的路径穿越条目。 */
  traversalEntries?: boolean;
  /** 完全自定义 zip 条目（解包炸弹/超大文件场景）。 */
  customZipEntries?: FakeMineruZipEntry[];
}

export interface MineruSubmission {
  fields: Map<string, string>;
  files: { fieldName: string; filename: string; bytes: Uint8Array }[];
}

export interface MineruFakeServer {
  /** 形如 http://127.0.0.1:port */
  baseUrl: string;
  /** 每次 POST /tasks 的完整提交记录（客户端提交参数断言依据）。 */
  submissions: MineruSubmission[];
  /** 状态轮询请求次数（断言轮询行为）。 */
  statusRequestCount: number;
  close(): Promise<void>;
}

interface FakeTask {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  fileNames: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  timers: ReturnType<typeof setTimeout>[];
}

/* ------------------------------------------------------------------ */
/* zip 构建/解析（store 模式，无依赖）                                  */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  /* 查表下标是 0-255 全表范围，索引必然存在。 */
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 生成 store 模式（不压缩）zip —— 与 MinerU 产物同构：条目名含 `/` 路径。 */
export function buildFakeMineruZip(entries: FakeMineruZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.byteLength);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0, true); // flags
    dv.setUint16(8, 0, true); // method: store
    dv.setUint32(10, 0, true); // mod time/date
    dv.setUint32(14, crc, true);
    dv.setUint32(18, entry.bytes.byteLength, true); // compressed size
    dv.setUint32(22, entry.bytes.byteLength, true); // uncompressed size
    dv.setUint16(26, name.byteLength, true);
    dv.setUint16(28, 0, true); // extra length
    local.set(name, 30);
    parts.push(local, entry.bytes);

    const cd = new Uint8Array(46 + name.byteLength);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true); // version made by
    cdv.setUint16(6, 20, true); // version needed
    cdv.setUint16(8, 0, true); // flags
    cdv.setUint16(10, 0, true); // method
    cdv.setUint32(12, 0, true); // mod time/date
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, entry.bytes.byteLength, true);
    cdv.setUint32(24, entry.bytes.byteLength, true);
    cdv.setUint16(28, name.byteLength, true);
    cdv.setUint16(30, 0, true); // extra length
    cdv.setUint16(32, 0, true); // comment length
    cdv.setUint16(34, 0, true); // disk start
    cdv.setUint16(36, 0, true); // internal attrs
    cdv.setUint32(38, 0, true); // external attrs
    cdv.setUint32(42, offset, true); // local header offset
    cd.set(name, 46);
    central.push(cd);
    offset += local.byteLength + entry.bytes.byteLength;
  }

  const cdSize = central.reduce((n, c) => n + c.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const part of [...parts, ...central, eocd]) {
    out.set(part, pos);
    pos += part.byteLength;
  }
  return out;
}

/** 读回 store zip 的条目（fake 自测与后续解包校验测试共用；只支持 method 0）。 */
export function parseStoredZipEntries(zip: Uint8Array): FakeMineruZipEntry[] {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocdPos = -1;
  for (let i = zip.byteLength - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos < 0) throw new Error('zip EOCD not found');
  const cdOffset = dv.getUint32(eocdPos + 16, true);
  const cdCount = dv.getUint16(eocdPos + 10, true);

  const entries: FakeMineruZipEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) {
      throw new Error('zip central directory corrupted');
    }
    const method = dv.getUint16(pos + 10, true);
    const compSize = dv.getUint32(pos + 20, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localOffset = dv.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(
      zip.subarray(pos + 46, pos + 46 + nameLen),
    );
    if (dv.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error('zip local header corrupted');
    }
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (method !== 0) throw new Error(`unsupported zip method ${method}`);
    entries.push({
      name,
      bytes: zip.subarray(dataStart, dataStart + compSize),
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* multipart 解析（二进制安全：文件内容可能不是 UTF-8）                  */
/* ------------------------------------------------------------------ */

function parseMultipart(
  body: Uint8Array,
  contentType: string,
): MineruSubmission {
  const fields = new Map<string, string>();
  const files: MineruSubmission['files'] = [];
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return { fields, files };
  const boundary = Buffer.from(`--${(match[1] ?? match[2] ?? '').trim()}`);
  const buf = Buffer.from(body);

  let pos = buf.indexOf(boundary);
  if (pos < 0) return { fields, files };
  pos += boundary.length;

  while (pos < buf.length) {
    let start = pos;
    if ((buf[start] ?? 0) === 0x0d && (buf[start + 1] ?? 0) === 0x0a)
      start += 2;
    /* 末块以 --boundary-- 结束。 */
    if ((buf[start] ?? 0) === 0x2d && (buf[start + 1] ?? 0) === 0x2d) break;
    const headerEnd = buf.indexOf('\r\n\r\n', start, 'latin1');
    if (headerEnd < 0) break;
    const header = buf.subarray(start, headerEnd).toString('latin1');
    const contentStart = headerEnd + 4;
    const next = buf.indexOf(boundary, contentStart);
    if (next < 0) break;
    let contentEnd = next;
    if (
      (buf[contentEnd - 2] ?? 0) === 0x0d &&
      (buf[contentEnd - 1] ?? 0) === 0x0a
    ) {
      contentEnd -= 2;
    }
    const disposition =
      /Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(
        header,
      );
    if (disposition) {
      const name = disposition[1] ?? '';
      const filename = disposition[2];
      if (filename !== undefined) {
        files.push({
          fieldName: name,
          filename,
          bytes: new Uint8Array(buf.subarray(contentStart, contentEnd)),
        });
      } else {
        fields.set(
          name,
          buf.subarray(contentStart, contentEnd).toString('utf8'),
        );
      }
    }
    pos = next + boundary.length;
  }
  return { fields, files };
}

/* ------------------------------------------------------------------ */
/* HTTP 服务                                                           */
/* ------------------------------------------------------------------ */

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function writeJson(res: ServerResponse, status: number, content: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(content));
}

function statusPayload(
  task: FakeTask,
  baseUrl: string,
): Record<string, unknown> {
  return {
    task_id: task.taskId,
    status: task.status,
    backend: 'auto',
    file_names: task.fileNames,
    created_at: task.createdAt,
    started_at: task.startedAt,
    completed_at: task.completedAt,
    error: task.error,
    status_url: `${baseUrl}/tasks/${task.taskId}`,
    result_url: `${baseUrl}/tasks/${task.taskId}/result`,
    queued_ahead: 0,
  };
}

export async function startMineruFakeServer(
  options: MineruFakeServerOptions = {},
): Promise<MineruFakeServer> {
  const submissions: MineruSubmission[] = [];
  const tasks = new Map<string, FakeTask>();
  const baseUrl = `http://127.0.0.1:0`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', baseUrl);

    if (req.method === 'POST' && url.pathname === '/tasks') {
      if (options.hang) return; /* 不写响应：连接挂起直到客户端超时。 */
      if (options.failOnSubmit) {
        writeJson(res, 500, { detail: 'fake server error' });
        return;
      }
      const body = await readBody(req);
      const submission = parseMultipart(
        body,
        req.headers['content-type'] ?? '',
      );
      submissions.push(submission);
      const task: FakeTask = {
        taskId: randomUUID(),
        status: 'pending',
        fileNames: submission.files.map((f) => f.filename),
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        error: null,
        timers: [],
      };
      tasks.set(task.taskId, task);
      const timers = task.timers;
      /* 提交响应恒为 pending（与真实 MinerU 一致：任务先排队），终态由定时器推进。
         failAfterMs 与 readyAfterMs 互斥：失败注入时不自动完成。 */
      if (options.failAfterMs !== undefined) {
        timers.push(
          setTimeout(() => {
            task.status = 'failed';
            task.completedAt = new Date().toISOString();
            task.error = 'fake: conversion failed';
          }, options.failAfterMs),
        );
      } else {
        timers.push(
          setTimeout(() => {
            task.status = 'completed';
            task.startedAt = new Date().toISOString();
            task.completedAt = new Date().toISOString();
          }, options.readyAfterMs ?? 0),
        );
      }
      if (options.invalidSubmitResponse) {
        writeJson(res, 202, { message: 'Task submitted successfully' });
        return;
      }
      writeJson(res, 202, {
        ...statusPayload(task, `http://${req.headers.host}`),
        message: 'Task submitted successfully',
      });
      return;
    }

    const statusMatch = /^\/tasks\/([^/]+)$/.exec(url.pathname);
    const statusTaskId = statusMatch?.[1];
    if (req.method === 'GET' && statusTaskId !== undefined) {
      if (options.hangStatus)
        return; /* 不写响应：连接挂起直到客户端超时/取消。 */
      statusRequestCount += 1;
      const task = tasks.get(statusTaskId);
      if (!task) {
        writeJson(res, 404, { detail: 'Task not found' });
        return;
      }
      writeJson(res, 200, statusPayload(task, `http://${req.headers.host}`));
      return;
    }

    const resultMatch = /^\/tasks\/([^/]+)\/result$/.exec(url.pathname);
    const resultTaskId = resultMatch?.[1];
    if (req.method === 'GET' && resultTaskId !== undefined) {
      if (options.hangResult)
        return; /* 不写响应：连接挂起直到客户端超时/取消。 */
      const task = tasks.get(resultTaskId);
      if (!task) {
        writeJson(res, 404, { detail: 'Task not found' });
        return;
      }
      if (task.status === 'pending' || task.status === 'processing') {
        writeJson(res, 202, {
          ...statusPayload(task, `http://${req.headers.host}`),
          message: 'Task result is not ready yet',
        });
        return;
      }
      if (task.status === 'failed') {
        writeJson(res, 409, {
          ...statusPayload(task, `http://${req.headers.host}`),
          message: 'Task execution failed',
        });
        return;
      }
      /* completed：返回 zip。 */
      if (options.corruptZip) {
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${task.taskId}.zip"`,
        });
        res.end(Buffer.from('not-a-zip-corrupted-bytes'));
        return;
      }
      const stem = task.fileNames[0]?.replace(/\.[^.]+$/, '') ?? 'document';
      const entries: FakeMineruZipEntry[] = options.customZipEntries ?? [
        {
          name: `${stem}/office/${stem}.md`,
          bytes: new TextEncoder().encode(`# ${stem}\n\nfake markdown body\n`),
        },
        {
          name: `${stem}/office/${stem}_content_list_v2.json`,
          bytes: new TextEncoder().encode('[]'),
        },
        {
          name: `${stem}/office/images/img_0.png`,
          bytes: new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          ]),
        },
      ];
      if (options.traversalEntries) {
        entries.push({
          name: `${stem}/office/../../evil.md`,
          bytes: new TextEncoder().encode('pwned'),
        });
      }
      const zip = buildFakeMineruZip(entries);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${task.taskId}.zip"`,
      });
      res.end(Buffer.from(zip));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      writeJson(res, 200, { status: 'healthy', version: '3.4.4-fake' });
      return;
    }

    writeJson(res, 404, { detail: 'Not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fake server failed to bind');
  }
  const liveBaseUrl = `http://127.0.0.1:${address.port}`;
  let statusRequestCount = 0;
  let closed = false;

  return {
    baseUrl: liveBaseUrl,
    submissions,
    /* getter：状态请求数在请求处理中递增，值拷贝会永远是 0。 */
    get statusRequestCount() {
      return statusRequestCount;
    },
    close: async () => {
      if (closed)
        return; /* close 幂等：测试可能手动关闭后由 afterEach 再关一次。 */
      closed = true;
      for (const task of tasks.values()) {
        for (const timer of task.timers) clearTimeout(timer);
      }
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
