import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  MINERU_MD_FILENAME,
  MINERU_ZIP_MAX_ENTRIES,
  readMineruMarkdown,
  unpackMineruZip,
} from './mineru-zip';
import { ASSET_TEXT_MAX_CHARACTERS } from './text-extraction';

/**
 * 最小 zip builder（测试专用）：stored 或 deflate 条目，crc32 填 0
 * （读取端不校验 CRC）。EOCD 无注释、无 zip64。
 */
function buildZip(
  entries: { name: string; data: Uint8Array; deflate?: boolean }[],
): Uint8Array {
  const encoder = new TextEncoder();
  /* 每个条目三块：local header、数据区、central directory 条目。 */
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const compressed = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const method = entry.deflate ? 8 : 0;

    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true); // version needed
    view.setUint16(8, method, true);
    view.setUint32(18, compressed.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local, compressed);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cd.buffer);
    cdView.setUint32(0, 0x02014b50, true);
    cdView.setUint16(10, method, true);
    cdView.setUint32(20, compressed.length, true);
    cdView.setUint32(24, entry.data.length, true);
    cdView.setUint16(28, nameBytes.length, true);
    cdView.setUint32(42, localOffset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    localOffset += local.length + compressed.length;
  }

  const cdSize = central.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, localOffset, true);

  const out = new Uint8Array(
    parts.reduce((sum, p) => sum + p.length, 0) + cdSize + eocd.length,
  );
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  for (const cdEntry of central) {
    out.set(cdEntry, offset);
    offset += cdEntry.length;
  }
  out.set(eocd, offset);
  return out;
}

const utf8 = (value: string) => new TextEncoder().encode(value);
const mdZip = (md: string, extra?: { name: string; data: Uint8Array }[]) =>
  buildZip([{ name: MINERU_MD_FILENAME, data: utf8(md) }, ...(extra ?? [])]);

describe('readMineruMarkdown', () => {
  it('读取 index.md 文本（stored 条目）', () => {
    const zip = mdZip('# 光合作用\n\n**叶绿体**是场所。');

    expect(readMineruMarkdown(zip)).toBe('# 光合作用\n\n**叶绿体**是场所。');
  });

  it('deflate 条目正确解压', () => {
    const zip = buildZip([
      { name: MINERU_MD_FILENAME, data: utf8('# 标题'), deflate: true },
    ]);

    expect(readMineruMarkdown(zip)).toBe('# 标题');
  });

  it('与图片条目共存时只取 index.md', () => {
    const zip = mdZip('# 正文', [
      { name: 'images/001.jpg', data: new Uint8Array([0xff, 0xd8]) },
    ]);

    expect(readMineruMarkdown(zip)).toBe('# 正文');
  });

  it('缺 index.md 视为结果损坏', () => {
    const zip = buildZip([{ name: 'content_list.json', data: utf8('[]') }]);

    expect(() => readMineruMarkdown(zip)).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('非 zip 字节视为结果损坏', () => {
    expect(() => readMineruMarkdown(utf8('这不是 zip'))).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('空字节视为结果损坏', () => {
    expect(() => readMineruMarkdown(new Uint8Array(0))).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('条目数超过上限拒绝（zip 炸弹的第一道闸）', () => {
    const entries = Array.from(
      { length: MINERU_ZIP_MAX_ENTRIES + 1 },
      (_, i) => ({
        name: `f${i}.bin`,
        data: new Uint8Array([1]),
      }),
    );
    entries[0] = { name: MINERU_MD_FILENAME, data: utf8('# md') };

    expect(() => readMineruMarkdown(buildZip(entries))).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('解压后超过字节上限拒绝', () => {
    /* emoji 是 4 字节/码点：超过 ASSET_TEXT_MAX_CHARACTERS 个就已突破字节上限。 */
    const big = '😀'.repeat(ASSET_TEXT_MAX_CHARACTERS + 1);

    expect(() => readMineruMarkdown(mdZip(big))).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('index.md 超字符上限时截断而不是拒绝', () => {
    const zip = mdZip('# 前\n\n' + '段'.repeat(ASSET_TEXT_MAX_CHARACTERS));

    const text = readMineruMarkdown(zip);
    expect([...text]).toHaveLength(ASSET_TEXT_MAX_CHARACTERS);
  });

  it('central directory 签名损坏视为结果损坏', () => {
    const zip = mdZip('# ok');
    /* 破坏 central directory 区（local 之后第一个字节）。 */
    const localEnd = 30 + MINERU_MD_FILENAME.length + utf8('# ok').length;
    const corrupted = zip.slice();
    corrupted[localEnd] = 0xff;

    expect(() => readMineruMarkdown(corrupted)).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('local header 偏移越界视为结果损坏', () => {
    const zip = mdZip('# ok');
    /* 把 central directory 里的 local offset 指向容器末尾之后。 */
    const cdStart = 30 + MINERU_MD_FILENAME.length + utf8('# ok').length;
    const corrupted = zip.slice();
    const view = new DataView(
      corrupted.buffer,
      corrupted.byteOffset,
      corrupted.byteLength,
    );
    view.setUint32(cdStart + 42, zip.length + 100, true);

    expect(() => readMineruMarkdown(corrupted)).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('md 内容非 UTF-8 视为结果损坏', () => {
    const zip = buildZip([
      { name: MINERU_MD_FILENAME, data: new Uint8Array([0xff, 0xfe, 0x00]) },
    ]);

    expect(() => readMineruMarkdown(zip)).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('空 md 视为结果损坏', () => {
    expect(() => readMineruMarkdown(mdZip('   \n '))).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('未知压缩方法视为结果损坏', () => {
    const zip = buildZip([
      { name: MINERU_MD_FILENAME, data: utf8('# x'), deflate: true },
    ]);
    /* 把 method 字段改成 99（LZMA），读取端应拒绝。 */
    const corrupted = zip.slice();
    const view = new DataView(
      corrupted.buffer,
      corrupted.byteOffset,
      corrupted.byteLength,
    );
    const cdStart =
      30 + MINERU_MD_FILENAME.length + deflateRawSync(utf8('# x')).length;
    view.setUint16(cdStart + 10, 99, true);

    expect(() => readMineruMarkdown(corrupted)).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });
});

/* ---------------- unpackMineruZip：C 阶段完整解包 ---------------- */

describe('unpackMineruZip', () => {
  it('解包全部条目，保留 name 与解压后的字节', () => {
    const zip = mdZip('# 正文', [
      { name: 'images/001.jpg', data: new Uint8Array([0xff, 0xd8]) },
      { name: 'content_list.json', data: utf8('[]') },
    ]);

    const entries = unpackMineruZip(zip);

    expect(entries.map((e) => e.name)).toEqual([
      MINERU_MD_FILENAME,
      'images/001.jpg',
      'content_list.json',
    ]);
    expect(entries[1]?.bytes).toEqual(new Uint8Array([0xff, 0xd8]));
  });

  it('deflate 条目解压后字节正确', () => {
    const zip = buildZip([
      {
        name: 'images/001.png',
        data: new Uint8Array([1, 2, 3, 4]),
        deflate: true,
      },
    ]);

    expect(unpackMineruZip(zip)[0]?.bytes).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it('单条目解压后超过上限明确失败（不静默截断）', () => {
    const big = new Uint8Array(1024);
    const zip = buildZip([{ name: 'images/big.bin', data: big }]);

    expect(() => unpackMineruZip(zip, { maxEntryBytes: 512 })).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('累计解压字节超过总上限明确失败', () => {
    const a = new Uint8Array(300);
    const b = new Uint8Array(300);
    const zip = buildZip([
      { name: 'a.bin', data: a },
      { name: 'b.bin', data: b },
    ]);

    expect(() => unpackMineruZip(zip, { maxTotalBytes: 500 })).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('自定义条目数上限低于容器声明时拒绝', () => {
    const zip = mdZip('# 正文', [
      { name: 'images/001.jpg', data: new Uint8Array([1]) },
    ]);

    expect(() => unpackMineruZip(zip, { maxEntries: 1 })).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });
});
