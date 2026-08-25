import { access } from 'node:fs/promises';
import path from 'node:path';
import { DrizzleAssetRepository } from '@educanvas/db';
import {
  AssetExtractionError,
  MineruClientError,
  WebPageError,
  buildMineruManifest,
  decodeMineruMarkdown,
  extractAssetText,
  extractReadableHtml,
  fetchMineruResult,
  imageMimeType,
  loadMineruConfig,
  routeDocumentExtraction,
  submitMineruTask,
  unpackMineruZip,
  validateMineruEntries,
  waitForMineruTask,
  type MineruBackend,
} from '@educanvas/asset-processing';
import { LocalObjectStorage } from '@educanvas/agent-runtime';
import type { Logger, Task } from 'graphile-worker';
import { z } from 'zod';
import { sha256Hex } from './asset-task-storage.js';
import { WebRenderError, renderReadableStoredHtml } from './render-web-page.js';

const payloadSchema = z.object({ jobId: z.string().uuid() }).strict();

async function findWorkspaceRoot(): Promise<string> {
  let current = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      await access(path.join(current, 'pnpm-workspace.yaml'));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error('workspace_root_not_found');
}

/* 与 delete-object-outbox 使用同一套根解析：资产对象与 Artifact 对象存在不同根下，
   用错根会静默读不到文件并被当成解析失败。 */
let assetStorage: Promise<LocalObjectStorage> | null = null;
function getAssetStorage(): Promise<LocalObjectStorage> {
  assetStorage ??= (async () => {
    const root = process.env.ASSET_STORAGE_ROOT
      ? path.resolve(process.env.ASSET_STORAGE_ROOT)
      : path.join(await findWorkspaceRoot(), 'uploads');
    return new LocalObjectStorage(root);
  })();
  return assetStorage;
}

/** settleTextExtraction 的 ready 终态形状（含 ADR-0026 结构化质量字段）。 */
type StructuredReadyOutcome = {
  status: 'ready';
  extractedText: string;
  derivedStorageKey: string;
  checksum: string;
  quality: 'structured';
  mimeType: 'text/markdown';
};

/**
 * 尝试通过 MinerU 产出结构化 Markdown（ADR-0026 决定 2/6）。
 *
 * 返回 ready 终态 = 结构化成功；返回 null = MinerU 不可用或结果损坏，
 * 调用方降级为纯文本抽取（degraded_plain_text）。对象存储写入失败不属于
 * 降级场景——内容没存上却标记结构化成功会丢数据，这类瞬时错误抛给
 * graphile-worker 重试。
 */
async function tryStructuredExtraction(input: {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  baseUrl: string;
  backend?: MineruBackend;
  storage: LocalObjectStorage;
  jobId: string;
  logger: Logger;
}): Promise<StructuredReadyOutcome | null> {
  let taskId: string | undefined;
  try {
    const submitted = await submitMineruTask({
      baseUrl: input.baseUrl,
      ...(input.backend ? { backend: input.backend } : {}),
      filename: input.filename,
      fileBytes: input.bytes,
      contentType: input.mimeType,
    });
    taskId = submitted.taskId;
    /* 外部 taskId 是跨系统追溯的关键（ADR-0026 决定 6）。 */
    input.logger.info(
      `MinerU 任务提交成功 jobId=${input.jobId} taskId=${taskId}`,
    );
    await waitForMineruTask({
      taskId: submitted.taskId,
      statusUrl: submitted.statusUrl,
    });
    const zipBytes = await fetchMineruResult({
      taskId: submitted.taskId,
      resultUrl: submitted.resultUrl,
    });
    /* 解包 → 白名单校验（ADR-0026 决定 3），任何越界明确失败降级。 */
    const extracted = validateMineruEntries(unpackMineruZip(zipBytes));
    const markdown = decodeMineruMarkdown(extracted.markdown.bytes);

    /*
     * 不可变派生表示（C3 布局，ADR-0026 决定 3）：同一 jobId 目录下放
     * index.md、images/ 与 manifest.json，图片引用不被丢弃、目录可验证。
     * md 文本同时写 settled 的 extractedText 字段镜像（compatibility read）。
     */
    const mdKey = `derived/${input.jobId}/index.md`;
    await input.storage.put({
      key: mdKey,
      bytes: extracted.markdown.bytes,
      contentType: 'text/markdown; charset=utf-8',
    });
    for (const image of extracted.images) {
      const imageKey = `derived/${input.jobId}/images/${image.name.slice('images/'.length)}`;
      await input.storage.put({
        key: imageKey,
        bytes: image.bytes,
        contentType: imageMimeType(image.name) ?? 'application/octet-stream',
      });
    }
    const manifest = buildMineruManifest(extracted);
    const manifestKey = `derived/${input.jobId}/manifest.json`;
    await input.storage.put({
      key: manifestKey,
      bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      contentType: 'application/json',
    });
    return {
      status: 'ready',
      extractedText: markdown,
      derivedStorageKey: mdKey,
      checksum: sha256Hex(new TextEncoder().encode(markdown)),
      /* 结构化表示：质量 structured、MIME text/markdown（ADR-0026 决定 6）。 */
      quality: 'structured' as const,
      mimeType: 'text/markdown' as const,
    };
  } catch (error) {
    if (error instanceof MineruClientError) {
      /* 只记稳定错误码，不记供应商错误体（secret containment）。 */
      input.logger.warn(
        `MinerU 不可用降级纯文本抽取 jobId=${input.jobId} taskId=${taskId ?? '-'} reason=${error.code}`,
      );
      return null;
    }
    throw error;
  }
}

/**
 * 异步抽取来源文本（ADR-0010 + ADR-0026 决定 2）。
 *
 * 路由：PDF/DOCX/PPTX/XLSX 先尝试 MinerU 结构化转换（未配置/不可用/结果
 * 损坏时降级为纯文本抽取，质量 degraded_plain_text）；TXT/Markdown 直接
 * UTF-8 解码，不调用 MinerU。
 *
 * 幂等由仓储保证：`beginTextExtractionAttempt` 只领取 queued/running 的任务，
 * `settleTextExtraction` 也只从这两个状态推进，所以 graphile-worker 的重投
 * 不会把已经 ready 的资产改回去，也不会重复追加文本 representation。
 *
 * 失败分两类，处理方式刻意不同：
 * - **解析失败**（扫描件、编码错误）是确定性的，重试没有意义，直接写终态 failed，
 *   用户能立刻看到原因；
 * - **读取字节失败或未知异常**可能是瞬时的（磁盘、权限、竞态），先抛给
 *   graphile-worker 退避重试；最后一次仍失败则写稳定的通用失败码。
 */
export const extractAssetText_: Task = async (rawPayload, helpers) => {
  const payload = payloadSchema.parse(rawPayload);
  const assets = new DrizzleAssetRepository();
  const pending = await assets.beginTextExtractionAttempt({
    jobId: payload.jobId,
  });
  /* 任务已终结（重复投递或已被人工处置）：安静退出，不当作错误。 */
  if (!pending) return;

  /* 路由与领取日志：只记稳定事实，不记存储路径（secret containment）。 */
  const route = routeDocumentExtraction(pending.mimeType);
  helpers.logger.info(
    `领取文本抽取任务 jobId=${payload.jobId} assetVersionId=${pending.assetVersionId} producer=${pending.producer} mimeType=${pending.mimeType} route=${route ?? 'none'}`,
  );

  try {
    const storage = await getAssetStorage();
    const bytes = await storage.read(pending.storageKey);

    if (pending.mimeType === 'text/html') {
      const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      let extractedText = extractReadableHtml(html, {
        allowEmptyText: true,
      }).text;
      if ([...extractedText].length < 200) {
        extractedText = await renderReadableStoredHtml(
          html,
          pending.webFinalUrl ?? undefined,
        );
      }
      const encoded = new TextEncoder().encode(extractedText);
      const checksum = sha256Hex(encoded);
      const textKey = `derived/text/${payload.jobId}/${checksum}.txt`;
      await storage.put({
        key: textKey,
        bytes: encoded,
        contentType: 'text/plain; charset=utf-8',
      });
      await assets.settleTextExtraction({
        jobId: payload.jobId,
        outcome: {
          status: 'ready',
          extractedText,
          derivedStorageKey: textKey,
          checksum,
        },
      });
      helpers.logger.info(
        `网页文本抽取完成 jobId=${payload.jobId} assetVersionId=${pending.assetVersionId} quality=degraded_plain_text mimeType=text/plain`,
      );
      return;
    }

    if (route === 'mineru') {
      const config = loadMineruConfig(process.env);
      if (config === null) {
        helpers.logger.warn(
          `MinerU 配置不可用（MINERU_BASE_URL/MINERU_BACKEND），文档降级纯文本抽取 jobId=${payload.jobId} assetVersionId=${pending.assetVersionId} mimeType=${pending.mimeType}`,
        );
      } else {
        const structured = await tryStructuredExtraction({
          bytes,
          mimeType: pending.mimeType,
          /* storageKey 保留原文件名（uploads/<owner>/<name>），取 basename 提交。 */
          filename: pending.storageKey.split('/').pop() ?? 'document',
          baseUrl: config.baseUrl,
          ...(config.backend ? { backend: config.backend } : {}),
          storage,
          jobId: payload.jobId,
          logger: helpers.logger,
        });
        if (structured !== null) {
          await assets.settleTextExtraction({
            jobId: payload.jobId,
            outcome: structured,
          });
          helpers.logger.info(
            `文本抽取完成 jobId=${payload.jobId} assetVersionId=${pending.assetVersionId} quality=structured mimeType=text/markdown`,
          );
          return;
        }
        /* null = MinerU 降级，继续走下面的纯文本抽取（degraded_plain_text）。 */
      }
    }

    const extractedText = await extractAssetText({
      bytes,
      mimeType: pending.mimeType,
    });
    /* D04：抽取文本内容写入对象存储（text representation 的内容身份），
       extractedText 旧字段保持同事务双写镜像（compatibility read）。 */
    const directlyStructured = route === 'direct_decode';
    const textKey = `derived/text/${payload.jobId}/${sha256Hex(
      new TextEncoder().encode(extractedText),
    )}.${directlyStructured ? 'md' : 'txt'}`;
    await storage.put({
      key: textKey,
      bytes: new TextEncoder().encode(extractedText),
      contentType: directlyStructured
        ? 'text/markdown; charset=utf-8'
        : 'text/plain; charset=utf-8',
    });
    await assets.settleTextExtraction({
      jobId: payload.jobId,
      outcome: {
        status: 'ready',
        extractedText,
        derivedStorageKey: textKey,
        checksum: sha256Hex(new TextEncoder().encode(extractedText)),
        ...(directlyStructured
          ? {
              quality: 'structured' as const,
              mimeType: 'text/markdown' as const,
            }
          : {}),
      },
    });
    /* TXT/Markdown 严格解码后本身就是结构化 Markdown；只有 MinerU 文档
       fallback 才取仓储缺省 degraded_plain_text，不能把两者混为同一质量。 */
    helpers.logger.info(
      `文本抽取完成 jobId=${payload.jobId} assetVersionId=${pending.assetVersionId} quality=${directlyStructured ? 'structured' : 'degraded_plain_text'} mimeType=${directlyStructured ? 'text/markdown' : 'text/plain'}`,
    );
  } catch (error) {
    if (
      error instanceof AssetExtractionError ||
      error instanceof WebPageError ||
      error instanceof WebRenderError
    ) {
      await assets.settleTextExtraction({
        jobId: payload.jobId,
        outcome: { status: 'failed', failureCode: error.code },
      });
      helpers.logger.warn(
        `文本抽取终态失败 jobId=${payload.jobId} assetVersionId=${pending.assetVersionId} failureCode=${error.code}`,
      );
      return;
    }
    /*
     * Graphile 在领取任务时已把 helpers.job.attempts 加一。最后一次仍失败时，
     * 不能只让队列永久失败而把业务账本留在 running；只落稳定失败码，不保存
     * 原始异常、路径或堆栈。较早的尝试继续抛出，由 Graphile 按策略退避重试。
     */
    if (helpers.job.attempts >= helpers.job.max_attempts) {
      await assets.settleTextExtraction({
        jobId: payload.jobId,
        outcome: {
          status: 'failed',
          failureCode: 'asset_processing_exhausted',
        },
      });
      helpers.logger.error(
        `文本抽取重试耗尽写安全终态 jobId=${payload.jobId} assetVersionId=${pending.assetVersionId} failureCode=asset_processing_exhausted`,
      );
      return;
    }
    throw error;
  }
};

export { extractAssetText_ as extractAssetTextTask };
