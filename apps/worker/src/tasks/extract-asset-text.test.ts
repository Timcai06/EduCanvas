import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo, logger } = vi.hoisted(() => ({
  repo: {
    beginTextExtractionAttempt: vi.fn(),
    settleTextExtraction: vi.fn(),
  },
  /* B3 日志链路：helpers.logger 的结构化字段断言。 */
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

/* MinerU 三步协议与结果解包/校验/解码全部 mock（真网络在 fake server 集成测试覆盖）。 */
const { extract, submit, wait, fetchResult, unpack, validate, decode } =
  vi.hoisted(() => ({
    extract: vi.fn(),
    submit: vi.fn(),
    wait: vi.fn(),
    fetchResult: vi.fn(),
    unpack: vi.fn(),
    validate: vi.fn(),
    decode: vi.fn(),
  }));
vi.mock('@educanvas/asset-processing', async () => {
  const actual = await vi.importActual<
    typeof import('@educanvas/asset-processing')
  >('@educanvas/asset-processing');
  return {
    ...actual,
    extractAssetText: extract,
    submitMineruTask: submit,
    waitForMineruTask: wait,
    fetchMineruResult: fetchResult,
    unpackMineruZip: unpack,
    validateMineruEntries: validate,
    decodeMineruMarkdown: decode,
  };
});

import {
  AssetExtractionError,
  MineruClientError,
} from '@educanvas/asset-processing';
import { extractAssetTextTask } from './extract-asset-text';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const SHA = expect.stringMatching(/^[a-f0-9]{64}$/);

const VERSION_ID = '22222222-2222-4222-8222-222222222222';

function run(attempts = 1, maxAttempts = 3) {
  return extractAssetTextTask({ jobId: JOB_ID }, {
    job: { attempts, max_attempts: maxAttempts },
    logger,
  } as never);
}

function pending(mimeType: string, storageKey = 'assets/a') {
  repo.beginTextExtractionAttempt.mockResolvedValue({
    storageKey,
    mimeType,
    assetVersionId: VERSION_ID,
    producer: 'default',
  });
}

describe('assets:extract_text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MINERU_BASE_URL;
    read.mockResolvedValue(new Uint8Array([1]));
    put.mockResolvedValue(undefined);
  });

  it('已终结的任务安静退出，不重复解析', async () => {
    /* graphile-worker 的重投会再次到达；重跑解析会重复追加 representation。 */
    repo.beginTextExtractionAttempt.mockResolvedValue(null);

    await run();

    expect(read).not.toHaveBeenCalled();
    expect(repo.settleTextExtraction).not.toHaveBeenCalled();
  });

  /* ---------------- direct_decode 路由（TXT/Markdown） ---------------- */

  it('TXT 直接解码不调用 MinerU（ADR-0026 决定 2）', async () => {
    pending('text/plain');
    extract.mockResolvedValue('课程资料');

    await run();

    expect(submit).not.toHaveBeenCalled();
    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        extractedText: '课程资料',
        derivedStorageKey: expect.stringMatching(
          /^derived\/text\/[a-f0-9-]+\/[a-f0-9]{64}\.md$/,
        ),
        checksum: SHA,
        quality: 'structured',
        mimeType: 'text/markdown',
      },
    });
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/\.md$/),
        contentType: 'text/markdown; charset=utf-8',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('quality=structured mimeType=text/markdown'),
    );
  });

  /* ---------------- mineru 路由：降级路径 ---------------- */

  it('MinerU 未配置时 PDF 走纯文本降级（缺省 degraded_plain_text）', async () => {
    pending('application/pdf');
    extract.mockResolvedValue('PDF 纯文本');

    await run();

    expect(submit).not.toHaveBeenCalled();
    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        extractedText: 'PDF 纯文本',
        derivedStorageKey: expect.stringMatching(/\.txt$/),
        checksum: SHA,
      },
    });
    /* B3：未配置是预期降级，warn 记原因但不带路径/密钥。 */
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('MinerU 未配置'),
    );
  });

  it('MinerU 服务不可用时降级为纯文本抽取', async () => {
    process.env.MINERU_BASE_URL = 'http://127.0.0.1:8001';
    pending('application/pdf');
    submit.mockRejectedValue(new MineruClientError('mineru_unreachable'));
    extract.mockResolvedValue('降级文本');

    await run();

    expect(extract).toHaveBeenCalledTimes(1);
    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        extractedText: '降级文本',
        derivedStorageKey: expect.stringMatching(/\.txt$/),
        checksum: SHA,
      },
    });
    /* B3：只记稳定错误码 reason，不记供应商错误体。 */
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('reason=mineru_unreachable'),
    );
  });

  it('结果 zip 损坏（缺 index.md）时降级为纯文本抽取', async () => {
    process.env.MINERU_BASE_URL = 'http://127.0.0.1:8001';
    pending('application/pdf');
    submit.mockResolvedValue({
      taskId: 't1',
      statusUrl: 'u1',
      resultUrl: 'r1',
    });
    wait.mockResolvedValue({ taskId: 't1', status: 'completed' });
    fetchResult.mockResolvedValue(new Uint8Array([1, 2, 3]));
    /* unpackMineruZip 是同步纯函数，mock 必须同步抛（mockRejectedValue 会传 Promise）。 */
    unpack.mockImplementation(() => {
      throw new MineruClientError('mineru_result_invalid');
    });
    extract.mockResolvedValue('降级文本');

    await run();

    expect(extract).toHaveBeenCalledTimes(1);
    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        extractedText: '降级文本',
        derivedStorageKey: expect.stringMatching(/\.txt$/),
        checksum: SHA,
      },
    });
  });

  /* ---------------- mineru 路由：结构化成功 ---------------- */

  it('MinerU 成功落 structured 质量与 Markdown 表示', async () => {
    process.env.MINERU_BASE_URL = 'http://127.0.0.1:8001';
    pending('application/pdf', 'uploads/fixture/讲义.pdf');
    submit.mockResolvedValue({
      taskId: 't1',
      statusUrl: 'u1',
      resultUrl: 'r1',
    });
    wait.mockResolvedValue({ taskId: 't1', status: 'completed' });
    fetchResult.mockResolvedValue(new Uint8Array([0x50, 0x4b]));
    const mdEntry = {
      name: 'index.md',
      bytes: new TextEncoder().encode('# 结构化标题\n\n正文。'),
    };
    const jpgEntry = { name: 'images/001.jpg', bytes: new Uint8Array([1, 2]) };
    /* 三个都是同步纯函数，mock 必须同步返回（不能是 Promise）。 */
    unpack.mockReturnValue([mdEntry, jpgEntry]);
    validate.mockReturnValue({ markdown: mdEntry, images: [jpgEntry] });
    decode.mockReturnValue('# 结构化标题\n\n正文。');

    await run();

    /* 派生表示三件套：index.md + images/ + manifest.json（ADR-0026 决定 3）。 */
    expect(put).toHaveBeenCalledTimes(3);
    const keys = put.mock.calls.map(([c]) => c.key);
    expect(keys).toEqual([
      `derived/${JOB_ID}/index.md`,
      `derived/${JOB_ID}/images/001.jpg`,
      `derived/${JOB_ID}/manifest.json`,
    ]);
    const manifestCall = put.mock.calls.find(
      ([c]) => c.key === `derived/${JOB_ID}/manifest.json`,
    );
    expect(
      JSON.parse(new TextDecoder().decode(manifestCall?.[0].bytes)),
    ).toEqual(
      expect.objectContaining({
        producer: 'mineru',
        images: [expect.objectContaining({ relativePath: 'images/001.jpg' })],
      }),
    );
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: '讲义.pdf',
        contentType: 'application/pdf',
      }),
    );
    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        extractedText: '# 结构化标题\n\n正文。',
        derivedStorageKey: expect.stringMatching(/\.md$/),
        checksum: SHA,
        quality: 'structured',
        mimeType: 'text/markdown',
      },
    });
    /* B3 日志链路：提交 taskId 与结构化完成都要落日志（ADR-0026 决定 6）。 */
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(`MinerU 任务提交成功 jobId=${JOB_ID} taskId=t1`),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(`quality=structured mimeType=text/markdown`),
    );
  });

  it('结构化对象写入失败是瞬时错误，抛给队列重试而不是降级', async () => {
    process.env.MINERU_BASE_URL = 'http://127.0.0.1:8001';
    pending('application/pdf');
    submit.mockResolvedValue({
      taskId: 't1',
      statusUrl: 'u1',
      resultUrl: 'r1',
    });
    wait.mockResolvedValue({ taskId: 't1', status: 'completed' });
    fetchResult.mockResolvedValue(new Uint8Array([0x50, 0x4b]));
    const mdEntry = {
      name: 'index.md',
      bytes: new TextEncoder().encode('# 标题'),
    };
    unpack.mockReturnValue([mdEntry]);
    validate.mockReturnValue({ markdown: mdEntry, images: [] });
    decode.mockReturnValue('# 标题');
    /* 第一次 put（index.md）失败：内容没存上不能标记结构化成功。 */
    put.mockRejectedValueOnce(new Error('EACCES'));

    await expect(run()).rejects.toThrow('EACCES');
    expect(repo.settleTextExtraction).not.toHaveBeenCalled();
  });

  /* ---------------- 通用失败路径（沿用原语义） ---------------- */

  it('解析失败是确定性的，写终态而不是抛给队列重试', async () => {
    pending('text/plain');
    extract.mockRejectedValue(
      new AssetExtractionError('text_content_unavailable'),
    );

    await run();

    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: { status: 'failed', failureCode: 'text_content_unavailable' },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failureCode=text_content_unavailable'),
    );
  });

  it('读取字节失败可能是瞬时的，抛给队列重试而不是写终态', async () => {
    pending('text/plain');
    read.mockRejectedValue(new Error('EACCES'));

    await expect(run()).rejects.toThrow('EACCES');
    expect(repo.settleTextExtraction).not.toHaveBeenCalled();
  });

  it('最后一次未知失败写安全终态，不把业务任务永久留在处理中', async () => {
    pending('text/plain');
    read.mockRejectedValue(new Error('包含本地路径的私有错误'));

    await run(3, 3);

    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'failed',
        failureCode: 'asset_processing_exhausted',
      },
    });
    expect(JSON.stringify(repo.settleTextExtraction.mock.calls)).not.toContain(
      '包含本地路径',
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('failureCode=asset_processing_exhausted'),
    );
  });
});
