import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterializedAssetInput } from '@educanvas/agent-runtime';

const { readStoredAssetBytes } = vi.hoisted(() => ({
  readStoredAssetBytes: vi.fn(),
}));
const { materializeOwnedReferences, loadOwnedCurrentStoredVersion } =
  vi.hoisted(() => ({
    materializeOwnedReferences: vi.fn(),
    loadOwnedCurrentStoredVersion: vi.fn(),
  }));

vi.mock('server-only', () => ({}));
vi.mock('./asset-storage', () => ({ readStoredAssetBytes }));
vi.mock('@educanvas/db', () => ({
  DrizzleAssetRepository: class {
    materializeOwnedReferences = materializeOwnedReferences;
    loadOwnedCurrentStoredVersion = loadOwnedCurrentStoredVersion;
  },
}));

import {
  DerivedTextIntegrityError,
  materializeAssetContextPlan,
  NativeAssetBudgetError,
  planAssetTextSource,
} from './asset-materialization';

const base = {
  reference: { assetId: 'asset-1', versionId: 'version-1', kind: 'document' },
  displayName: '研究资料.pdf',
  mimeType: 'application/pdf',
  byteSize: 100,
  extractedText: '镜像正文',
  transcriptionText: null,
  textRepresentation: {
    kind: 'text' as const,
    quality: 'structured' as const,
    variant: 'default',
    producer: 'mineru',
    producerVersion: 'mineru.v1',
  },
  derivedTextSource: {
    storageKey: 'derived/job-1/index.md',
    checksumSha256: 'a'.repeat(64),
  },
  derivedMarkdown: null,
} satisfies MaterializedAssetInput;

describe('planAssetTextSource（ADR-0026 第 5/6 节文本源决策）', () => {
  it('processing 质量明确失败，不静默带入', () => {
    const decision = planAssetTextSource({
      ...base,
      textRepresentation: {
        ...base.textRepresentation!,
        quality: 'processing',
      },
      derivedTextSource: null,
    });
    expect(decision).toEqual({ kind: 'not_ready', reason: 'processing' });
  });

  it('failed 质量明确失败，不静默带入', () => {
    const decision = planAssetTextSource({
      ...base,
      textRepresentation: {
        ...base.textRepresentation!,
        quality: 'failed',
      },
      derivedTextSource: null,
    });
    expect(decision).toEqual({ kind: 'not_ready', reason: 'failed' });
  });

  it('structured 且带派生文件时读取 Markdown 并核对 checksum', () => {
    expect(planAssetTextSource(base)).toEqual({
      kind: 'read_derived',
      storageKey: 'derived/job-1/index.md',
      checksumSha256: 'a'.repeat(64),
    });
  });

  it('degraded_plain_text 走 extractedText 兼容，不读派生文件', () => {
    const decision = planAssetTextSource({
      ...base,
      textRepresentation: {
        ...base.textRepresentation!,
        quality: 'degraded_plain_text',
        producer: 'textractor',
        producerVersion: 'textractor.v1',
      },
      derivedTextSource: null,
    });
    expect(decision).toEqual({ kind: 'compat_text' });
  });

  it('无表示身份（图片/音频/旧资产）走 extractedText 兼容', () => {
    const decision = planAssetTextSource({
      ...base,
      textRepresentation: null,
      derivedTextSource: null,
    });
    expect(decision).toEqual({ kind: 'compat_text' });
  });

  it('structured 但无派生文件（理论回退）不失败，走 extractedText 兼容', () => {
    const decision = planAssetTextSource({
      ...base,
      derivedTextSource: null,
    });
    expect(decision).toEqual({ kind: 'compat_text' });
  });
});

/* ---------- E2：派生图片进 native image parts（docx 内嵌图场景） ---------- */

const identity = { token: '', studentId: 'student-1' };
const docxPart = {
  type: 'asset_ref' as const,
  reference: {
    assetId: 'asset-1',
    versionId: 'version-1',
    kind: 'document' as const,
  },
  usage: 'context' as const,
};

/** C3 写入布局的镜像：index.md 与 manifest、图片字节都进对象存储 mock。 */
function markdownObject(text: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    relativePath: 'index.md',
    byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes,
  };
}

function imageObject(
  relativePath: string,
  size: number,
  position: number,
  mimeType: 'image/png' | 'image/gif' = 'image/png',
) {
  const bytes = new Uint8Array(size).fill(position);
  return {
    relativePath,
    byteSize: size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mimeType,
    position,
    bytes,
  };
}

function manifestBytes(images: ReturnType<typeof imageObject>[]) {
  return new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      producer: 'mineru',
      markdown: {
        relativePath: 'index.md',
        sha256: 'd'.repeat(64),
        byteSize: 8,
        mimeType: 'text/markdown',
      },
      images: images.map((image) => ({
        relativePath: image.relativePath,
        byteSize: image.byteSize,
        sha256: image.sha256,
        mimeType: image.mimeType,
        position: image.position,
      })),
    }),
  );
}

function mockStorage(entries: Record<string, Uint8Array>) {
  readStoredAssetBytes.mockImplementation(async (key: string) => {
    const bytes = entries[key];
    if (!bytes) throw new Error(`storage missing: ${key}`);
    return bytes;
  });
}

function structuredVersion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    reference: { assetId: 'asset-1', versionId: 'version-1', kind: 'document' },
    displayName: '讲义.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    byteSize: 2048,
    extractedText: '镜像正文',
    transcriptionText: null,
    textRepresentation: {
      kind: 'text' as const,
      quality: 'structured' as const,
      variant: 'default',
      producer: 'mineru',
      producerVersion: 'mineru.v1',
    },
    derivedTextSource: {
      storageKey: 'derived/job-1/index.md',
      checksumSha256: markdownObject('讲义正文').sha256,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  materializeOwnedReferences.mockResolvedValue([structuredVersion()]);
});

describe('materializeAssetContextPlan 派生图片（E2）', () => {
  it('structured 文档 + image 能力：派生图按 position 进 nativeImages 并核对字节', async () => {
    const markdown = markdownObject('讲义正文');
    const [fig2, fig1] = [
      imageObject('images/fig2.png', 60, 2),
      imageObject('images/fig1.png', 40, 1),
    ];
    mockStorage({
      'derived/job-1/index.md': markdown.bytes,
      'derived/job-1/manifest.json': manifestBytes([fig2, fig1]),
      'derived/job-1/images/fig1.png': fig1.bytes,
      'derived/job-1/images/fig2.png': fig2.bytes,
    });

    const plan = await materializeAssetContextPlan({
      identity,
      spaceId: 'space-1',
      parts: [docxPart],
      nativeAssetKinds: ['image'],
    });

    expect(plan.nativeImages).toEqual([
      {
        versionId: 'version-1',
        mimeType: 'image/png',
        data: Buffer.from(fig1.bytes).toString('base64'),
        resourcePath: 'images/fig1.png',
      },
      {
        versionId: 'version-1',
        mimeType: 'image/png',
        data: Buffer.from(fig2.bytes).toString('base64'),
        resourcePath: 'images/fig2.png',
      },
    ]);
  });

  it('能力不含 image 时不读派生图（manifest 不被读取）', async () => {
    const markdown = markdownObject('讲义正文');
    mockStorage({ 'derived/job-1/index.md': markdown.bytes });

    const plan = await materializeAssetContextPlan({
      identity,
      spaceId: 'space-1',
      parts: [docxPart],
    });

    expect(plan.nativeImages).toEqual([]);
    expect(readStoredAssetBytes.mock.calls.map((call) => call[0])).toEqual([
      'derived/job-1/index.md',
    ]);
  });

  it('manifest 中白名单外 MIME（gif/bmp）不进入 native parts', async () => {
    const markdown = markdownObject('讲义正文');
    const [gif, png] = [
      imageObject('images/animated.gif', 80, 1, 'image/gif'),
      imageObject('images/fig1.png', 40, 2),
    ];
    mockStorage({
      'derived/job-1/index.md': markdown.bytes,
      'derived/job-1/manifest.json': manifestBytes([gif, png]),
      'derived/job-1/images/fig1.png': png.bytes,
    });

    const plan = await materializeAssetContextPlan({
      identity,
      spaceId: 'space-1',
      parts: [docxPart],
      nativeAssetKinds: ['image'],
    });

    expect(plan.nativeImages).toHaveLength(1);
    expect(plan.nativeImages[0]!.resourcePath).toBe('images/fig1.png');
  });

  it('manifest 缺失（C3 双写异常）→ 完整性失败，不静默丢图', async () => {
    const markdown = markdownObject('讲义正文');
    mockStorage({ 'derived/job-1/index.md': markdown.bytes });

    await expect(
      materializeAssetContextPlan({
        identity,
        spaceId: 'space-1',
        parts: [docxPart],
        nativeAssetKinds: ['image'],
      }),
    ).rejects.toBeInstanceOf(DerivedTextIntegrityError);
  });

  it('图片字节与 manifest 声明不符 → 完整性失败', async () => {
    const markdown = markdownObject('讲义正文');
    const declared = imageObject('images/fig1.png', 40, 1);
    mockStorage({
      'derived/job-1/index.md': markdown.bytes,
      'derived/job-1/manifest.json': manifestBytes([declared]),
      /* 实际字节与声明 sha256 不符（内容被篡改/损坏）。 */
      'derived/job-1/images/fig1.png': new Uint8Array(40).fill(7),
    });

    await expect(
      materializeAssetContextPlan({
        identity,
        spaceId: 'space-1',
        parts: [docxPart],
        nativeAssetKinds: ['image'],
      }),
    ).rejects.toBeInstanceOf(DerivedTextIntegrityError);
  });

  it('用户原生图与派生图共享 count 预算，超限明确失败', async () => {
    const markdown = markdownObject('讲义正文');
    const images = Array.from({ length: 12 }, (_, index) =>
      imageObject(`images/fig${index}.png`, 10, index),
    );
    const storage: Record<string, Uint8Array> = {
      'derived/job-1/index.md': markdown.bytes,
      'derived/job-1/manifest.json': manifestBytes(images),
      'user/1.png': new Uint8Array(20).fill(1),
    };
    for (const image of images) {
      storage[`derived/job-1/${image.relativePath}`] = image.bytes;
    }
    mockStorage(storage);
    /* 用户原生图版本没有文本（图片无 extractedText），才会被判定为原生引用。 */
    materializeOwnedReferences.mockResolvedValue([
      structuredVersion(),
      {
        ...structuredVersion(),
        reference: {
          assetId: 'asset-2',
          versionId: 'version-2',
          kind: 'image',
        },
        extractedText: null,
        textRepresentation: null,
        derivedTextSource: null,
      },
    ]);
    loadOwnedCurrentStoredVersion.mockResolvedValue({
      mimeType: 'image/png',
      storageKey: 'user/1.png',
    });

    const error = await materializeAssetContextPlan({
      identity,
      spaceId: 'space-1',
      parts: [
        docxPart,
        {
          type: 'asset_ref' as const,
          reference: {
            assetId: 'asset-2',
            versionId: 'version-2',
            kind: 'image' as const,
          },
          usage: 'context' as const,
        },
      ],
      nativeAssetKinds: ['image'],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NativeAssetBudgetError);
    expect((error as NativeAssetBudgetError).reason).toBe('count');
  });

  it('用户原生图与派生图共享 bytes 预算，超限明确失败', async () => {
    const markdown = markdownObject('讲义正文');
    const images = Array.from({ length: 2 }, (_, index) =>
      imageObject(`images/fig${index}.png`, 8 * 1024 * 1024, index),
    );
    const storage: Record<string, Uint8Array> = {
      'derived/job-1/index.md': markdown.bytes,
      'derived/job-1/manifest.json': manifestBytes(images),
      'user/1.png': new Uint8Array(9 * 1024 * 1024).fill(1),
    };
    for (const image of images) {
      storage[`derived/job-1/${image.relativePath}`] = image.bytes;
    }
    mockStorage(storage);
    materializeOwnedReferences.mockResolvedValue([
      structuredVersion(),
      {
        ...structuredVersion(),
        reference: {
          assetId: 'asset-2',
          versionId: 'version-2',
          kind: 'image',
        },
        extractedText: null,
        textRepresentation: null,
        derivedTextSource: null,
      },
    ]);
    loadOwnedCurrentStoredVersion.mockResolvedValue({
      mimeType: 'image/png',
      storageKey: 'user/1.png',
    });

    const error = await materializeAssetContextPlan({
      identity,
      spaceId: 'space-1',
      parts: [
        docxPart,
        {
          type: 'asset_ref' as const,
          reference: {
            assetId: 'asset-2',
            versionId: 'version-2',
            kind: 'image' as const,
          },
          usage: 'context' as const,
        },
      ],
      nativeAssetKinds: ['image'],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NativeAssetBudgetError);
    expect((error as NativeAssetBudgetError).reason).toBe('bytes');
  });

  it('degraded / 无派生源资产不产生派生图', async () => {
    const degraded = structuredVersion({
      textRepresentation: {
        kind: 'text' as const,
        quality: 'degraded_plain_text' as const,
        variant: 'default',
        producer: 'textractor',
        producerVersion: 'textractor.v1',
      },
      derivedTextSource: null,
    });
    materializeOwnedReferences.mockResolvedValue([degraded]);
    mockStorage({
      'derived/job-1/index.md': markdownObject('镜像正文').bytes,
    });

    const plan = await materializeAssetContextPlan({
      identity,
      spaceId: 'space-1',
      parts: [docxPart],
      nativeAssetKinds: ['image'],
    });

    expect(plan.nativeImages).toEqual([]);
    expect(readStoredAssetBytes.mock.calls.map((call) => call[0])).toEqual([]);
  });
});
