/**
 * G1：fake MinerU 服务 × worker 任务端到端故障测试（ADR-0026 验证方式 7）。
 *
 * 与 extract-asset-text.test.ts（全 mock）不同：本文件让 mineru-client 三步协议
 * （submit → wait → fetch）、zip 解包/白名单校验/Markdown 解码/manifest 构建全部
 * 走真实实现，只 mock 仓储（DB）、对象存储（LocalObjectStorage）与本地纯文本
 * 抽取（extractAssetText，与网络无关，单测已覆盖）。覆盖超时/重试/损坏/路径穿越/
 * 解包炸弹/secret containment 在完整链路上的落库行为。
 *
 * 注意：轮询 15 分钟超时与单请求 60 秒超时的注入在 mineru-client.test.ts 已用
 * pollTimeoutMs/timeoutMs 参数覆盖（A3/A4），任务层不暴露缩短入口，本文件不重复。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildFakeMineruZip,
  startMineruFakeServer,
  type MineruFakeServer,
} from '@educanvas/asset-processing/test-utils';

const { repo, logger } = vi.hoisted(() => ({
  repo: {
    beginTextExtractionAttempt: vi.fn(),
    settleTextExtraction: vi.fn(),
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@educanvas/db', () => ({
  DrizzleAssetRepository: vi.fn(function () {
    return repo;
  }),
}));

const { read, put } = vi.hoisted(() => ({ read: vi.fn(), put: vi.fn() }));
vi.mock('@educanvas/agent-runtime', () => ({
  LocalObjectStorage: vi.fn(function () {
    return { read, put };
  }),
}));

/* 只覆盖本地纯文本抽取（降级路径）；mineru-client 与 zip 链全部真实。 */
const { extract } = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock('@educanvas/asset-processing', async () => {
  const actual = await vi.importActual<
    typeof import('@educanvas/asset-processing')
  >('@educanvas/asset-processing');
  return { ...actual, extractAssetText: extract };
});

import { extractAssetTextTask } from './extract-asset-text';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const SHA = expect.stringMatching(/^[a-f0-9]{64}$/);

const servers: MineruFakeServer[] = [];
const FILE_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

async function start(options?: Parameters<typeof startMineruFakeServer>[0]) {
  const server = await startMineruFakeServer(options);
  servers.push(server);
  /* 任务在运行时读 env（routeDocumentExtraction 之后），fake 端口是动态的，
     因此先启动再注入。 */
  process.env.MINERU_BASE_URL = server.baseUrl;
  return server;
}

function run(attempts = 1) {
  return extractAssetTextTask({ jobId: JOB_ID }, {
    job: { attempts, max_attempts: 3 },
    logger,
  } as never);
}

/* fake server 的 multipart 解析按 latin1 解码文件名，中文会被打成乱码，
   集成断言用 ASCII 文件名避免编码噪声（文件名编码本身不是本文件主题）。 */
function pending(
  mimeType = 'application/pdf',
  storageKey = 'uploads/fixture/syllabus.pdf',
) {
  repo.beginTextExtractionAttempt.mockResolvedValue({
    storageKey,
    mimeType,
    assetVersionId: VERSION_ID,
    producer: 'default',
  });
}

const SAMPLE_MD = '# 结构化标题\n\n表格与公式正文。';

beforeEach(() => {
  vi.clearAllMocks();
  repo.beginTextExtractionAttempt.mockReset();
  repo.settleTextExtraction.mockReset();
  read.mockReset();
  put.mockReset();
  extract.mockReset();
  extract.mockResolvedValue('降级纯文本。');
  read.mockResolvedValue(FILE_BYTES);
  delete process.env.MINERU_BASE_URL;
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  delete process.env.MINERU_BASE_URL;
});

describe('extract-asset-text × fake MinerU（ADR-0026 验证方式 7）', () => {
  it('成功链路：structured 落库并写出 index.md/images/manifest 三件套', async () => {
    const server = await start({
      /* 真实 MinerU zip 布局（G2 实测对齐）：<base>/<parse_dir>/<base>.md + images/。 */
      customZipEntries: [
        {
          name: 'syllabus/office/syllabus.md',
          bytes: new TextEncoder().encode(SAMPLE_MD),
        },
        {
          name: 'syllabus/office/images/001.jpg',
          bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        },
      ],
    });
    pending();

    await run();

    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        extractedText: SAMPLE_MD,
        derivedStorageKey: `derived/${JOB_ID}/index.md`,
        checksum: SHA,
        quality: 'structured',
        mimeType: 'text/markdown',
      },
    });
    const keys = put.mock.calls.map(([call]) => call.key);
    expect(keys).toEqual([
      `derived/${JOB_ID}/index.md`,
      `derived/${JOB_ID}/images/001.jpg`,
      `derived/${JOB_ID}/manifest.json`,
    ]);
    const manifestCall = put.mock.calls.find(
      ([call]) => call.key === `derived/${JOB_ID}/manifest.json`,
    );
    expect(
      JSON.parse(new TextDecoder().decode(manifestCall?.[0].bytes)),
    ).toEqual(
      expect.objectContaining({
        producer: 'mineru',
        images: [expect.objectContaining({ relativePath: 'images/001.jpg' })],
      }),
    );
    /* 提交给 fake server 的载荷要带原文件名与真实 MIME（ADRU 追溯）。 */
    expect(server.submissions).toHaveLength(1);
    expect(server.submissions[0]!.files[0]).toMatchObject({
      filename: 'syllabus.pdf',
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(`MinerU 任务提交成功 jobId=${JOB_ID}`),
    );
  });

  it('结果损坏（非 zip 字节）降级为纯文本，不写任何派生对象', async () => {
    await start({ corruptZip: true });
    pending();

    await run();

    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        extractedText: '降级纯文本。',
        derivedStorageKey: expect.stringMatching(/derived\/text\/.*\.txt$/),
        checksum: SHA,
      },
    });
    /* 降级路径只写 derived/text/ 纯文本表示，不写任何 derived/<jobId>/ 派生对象。 */
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]![0].key).toMatch(/^derived\/text\/.*\.txt$/);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`reason=mineru_result_invalid`),
    );
  });

  it('路径穿越条目拒绝并降级，派生目录不落任何文件', async () => {
    await start({ traversalEntries: true });
    pending();

    await run();

    expect(repo.settleTextExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: expect.objectContaining({ status: 'ready' }),
      }),
    );
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]![0].key).toMatch(/^derived\/text\/.*\.txt$/);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`reason=mineru_result_invalid`),
    );
  });

  it('解包炸弹（条目数超上限）拒绝并降级', async () => {
    /* MINERU_ZIP_MAX_ENTRIES = 200，构造 201 条超限目录。 */
    const bombEntries = Array.from({ length: 201 }, (_, i) => ({
      name: `fragment_${i}.bin`,
      bytes: new Uint8Array([0]),
    }));
    await start({ customZipEntries: bombEntries });
    pending();

    await run();

    expect(repo.settleTextExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: expect.objectContaining({ status: 'ready' }),
      }),
    );
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]![0].key).toMatch(/^derived\/text\/.*\.txt$/);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`reason=mineru_result_invalid`),
    );
  });

  it('派生对象写入失败是瞬时错误：抛给队列重试，不写终态', async () => {
    await start();
    pending();
    put.mockRejectedValue(new Error('disk full'));

    await expect(run()).rejects.toThrow('disk full');
    expect(repo.settleTextExtraction).not.toHaveBeenCalled();
  });

  it('secret containment：日志只含稳定事实，不含存储路径与供应商错误体', async () => {
    await start({ corruptZip: true });
    pending();

    await run();

    /* 领取日志只记 jobId/mimeType/route，不记 storageKey（secret containment）。 */
    for (const message of logger.info.mock.calls) {
      expect(String(message[0])).not.toContain('uploads/');
    }
    /* 降级 warn 只含稳定错误码，不含 fake 的原始错误体。 */
    const warnMessages = logger.warn.mock.calls.map(([message]) =>
      String(message),
    );
    for (const message of warnMessages) {
      expect(message).not.toContain('not-a-zip-corrupted-bytes');
    }
  });
});
