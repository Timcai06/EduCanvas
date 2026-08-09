import { beforeEach, describe, expect, it, vi } from 'vitest';

const { repo } = vi.hoisted(() => ({
  repo: {
    beginTextExtractionAttempt: vi.fn(),
    settleTextExtraction: vi.fn(),
  },
}));

vi.mock('@educanvas/db', () => ({
  DrizzleAssetRepository: vi.fn(function () {
    return repo;
  }),
}));

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@educanvas/agent-runtime', () => ({
  LocalObjectStorage: vi.fn(function () {
    return { read, put: vi.fn() };
  }),
}));

const { extract } = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock('@educanvas/asset-processing', async () => {
  const actual = await vi.importActual<
    typeof import('@educanvas/asset-processing')
  >('@educanvas/asset-processing');
  return { ...actual, extractAssetText: extract };
});

import { AssetExtractionError } from '@educanvas/asset-processing';
import { extractAssetTextTask } from './extract-asset-text';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

function run(attempts = 1, maxAttempts = 3) {
  return extractAssetTextTask({ jobId: JOB_ID }, {
    job: { attempts, max_attempts: maxAttempts },
  } as never);
}

describe('assets:extract_text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('已终结的任务安静退出，不重复解析', async () => {
    /* graphile-worker 的重投会再次到达；重跑解析会重复追加 representation。 */
    repo.beginTextExtractionAttempt.mockResolvedValue(null);

    await run();

    expect(read).not.toHaveBeenCalled();
    expect(repo.settleTextExtraction).not.toHaveBeenCalled();
  });

  it('成功时写入 ready 终态', async () => {
    repo.beginTextExtractionAttempt.mockResolvedValue({
      storageKey: 'assets/a',
      mimeType: 'application/pdf',
    });
    read.mockResolvedValue(new Uint8Array([1]));
    extract.mockResolvedValue('课程资料');

    await run();

    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: {
        status: 'ready',
        extractedText: '课程资料',
        derivedStorageKey: expect.stringMatching(
          /^derived\/text\/[a-f0-9-]+\/[a-f0-9]{64}\.txt$/,
        ),
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
  });

  it('解析失败是确定性的，写终态而不是抛给队列重试', async () => {
    repo.beginTextExtractionAttempt.mockResolvedValue({
      storageKey: 'assets/a',
      mimeType: 'application/pdf',
    });
    read.mockResolvedValue(new Uint8Array([1]));
    extract.mockRejectedValue(new AssetExtractionError('pdf_text_unavailable'));

    await run();

    expect(repo.settleTextExtraction).toHaveBeenCalledWith({
      jobId: JOB_ID,
      outcome: { status: 'failed', failureCode: 'pdf_text_unavailable' },
    });
  });

  it('读取字节失败可能是瞬时的，抛给队列重试而不是写终态', async () => {
    repo.beginTextExtractionAttempt.mockResolvedValue({
      storageKey: 'assets/a',
      mimeType: 'application/pdf',
    });
    read.mockRejectedValue(new Error('EACCES'));

    await expect(run()).rejects.toThrow('EACCES');
    expect(repo.settleTextExtraction).not.toHaveBeenCalled();
  });

  it('最后一次未知失败写安全终态，不把业务任务永久留在处理中', async () => {
    repo.beginTextExtractionAttempt.mockResolvedValue({
      storageKey: 'assets/a',
      mimeType: 'application/pdf',
    });
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
  });
});
