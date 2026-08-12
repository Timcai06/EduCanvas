import { describe, expect, it } from 'vitest';
import { MINERU_MD_FILENAME } from './mineru-zip';
import { imageMimeType, validateMineruEntries } from './mineru-validate';
import type { MineruZipEntry } from './mineru-zip';

const utf8 = (value: string) => new TextEncoder().encode(value);

/* 真实 MinerU 3.4.4 zip 布局：<base>/<parse_dir>/<base>.md + images/（G2 实测对齐）。 */
const BASE = 'syllabus';
const MD = `${BASE}/office/${BASE}.md`;
const IMG = (file: string) => `${BASE}/office/images/${file}`;

function entry(name: string, data?: Uint8Array): MineruZipEntry {
  return { name, bytes: data ?? utf8('x') };
}

function withMd(extra: MineruZipEntry[]): MineruZipEntry[] {
  return [entry(MD, utf8('# 正文')), ...extra];
}

describe('validateMineruEntries', () => {
  it('真实布局：markdown 与白名单图片保留，辅助产物忽略，输出归一化', () => {
    const result = validateMineruEntries(
      withMd([
        entry(IMG('001.jpg'), new Uint8Array([0xff, 0xd8])),
        entry(`${BASE}/office/${BASE}_content_list_v2.json`, utf8('[]')),
        entry(`${BASE}/office/${BASE}_layout.pdf`, utf8('%PDF')),
      ]),
    );

    /* markdown/图片归一化为派生存储路径（zip 内部布局不泄漏）。 */
    expect(result.markdown.name).toBe(MINERU_MD_FILENAME);
    expect(result.images.map((i) => i.name)).toEqual(['images/001.jpg']);
  });

  it('多种白名单图片扩展名全部保留（大小写不敏感）', () => {
    const result = validateMineruEntries(
      withMd([
        entry(IMG('a.jpeg')),
        entry(IMG('b.PNG')),
        entry(IMG('c.gif')),
        entry(IMG('d.webp')),
        entry(IMG('e.bmp')),
      ]),
    );

    expect(result.images.map((i) => i.name)).toEqual([
      'images/a.jpeg',
      'images/b.PNG',
      'images/c.gif',
      'images/d.webp',
      'images/e.bmp',
    ]);
  });

  it('缺 markdown 视为结果损坏', () => {
    expect(() => validateMineruEntries([entry(IMG('001.jpg'))])).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('markdown 文件名与顶层目录不一致视为损坏（伪装 md）', () => {
    expect(() =>
      validateMineruEntries([
        entry(`${BASE}/office/other.md`),
        entry(IMG('001.jpg')),
      ]),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
    expect(() =>
      validateMineruEntries([entry('other/office/syllabus.md')]),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('多个 markdown 条目视为损坏', () => {
    expect(() =>
      validateMineruEntries([entry(MD), entry(`${BASE}/office/${BASE}.md`)]),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('.. 路径穿越条目明确失败（不静默丢弃）', () => {
    expect(() =>
      validateMineruEntries(withMd([entry(`${BASE}/office/../evil.txt`)])),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('images/ 下的 .. 穿越明确失败', () => {
    expect(() =>
      validateMineruEntries(withMd([entry(IMG('../evil.jpg'))])),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('绝对路径条目明确失败（/ 开头与盘符）', () => {
    expect(() => validateMineruEntries(withMd([entry('/etc/passwd')]))).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
    expect(() =>
      validateMineruEntries(withMd([entry('C:\\windows\\evil.jpg')])),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('反斜杠伪装路径明确失败', () => {
    expect(() =>
      validateMineruEntries(
        withMd([entry(`${BASE}\\office\\images\\evil.jpg`)]),
      ),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('根级条目（非 <base>/<parse_dir>/ 前缀）明确失败', () => {
    expect(() => validateMineruEntries(withMd([entry('root.txt')]))).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
    expect(() =>
      validateMineruEntries(withMd([entry('another/office/a.md')])),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('images/ 下非白名单扩展名明确失败（引用会悬空，不能静默遗漏）', () => {
    for (const name of [IMG('a.tif'), IMG('a.txt'), IMG('a.html')]) {
      expect(() => validateMineruEntries(withMd([entry(name)]))).toThrow(
        expect.objectContaining({ code: 'mineru_result_invalid' }),
      );
    }
  });

  it('svg 排除白名单（可执行脚本载体，违反分层信任）', () => {
    expect(() => validateMineruEntries(withMd([entry(IMG('a.svg'))]))).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('images/ 嵌套子目录明确失败（只接受平铺单层）', () => {
    expect(() =>
      validateMineruEntries(withMd([entry(IMG('sub/a.jpg'))])),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('只有 markdown 时图片列表为空', () => {
    const result = validateMineruEntries([entry(MD)]);

    expect(result.images).toEqual([]);
  });
});

describe('imageMimeType', () => {
  it('扩展名映射到标准 MIME（manifest 用）', () => {
    expect(imageMimeType('images/a.jpg')).toBe('image/jpeg');
    expect(imageMimeType('images/a.jpeg')).toBe('image/jpeg');
    expect(imageMimeType('images/a.png')).toBe('image/png');
    expect(imageMimeType('images/a.gif')).toBe('image/gif');
    expect(imageMimeType('images/a.webp')).toBe('image/webp');
    expect(imageMimeType('images/a.bmp')).toBe('image/bmp');
  });

  it('未知扩展名返回 null（调用方自行决定）', () => {
    expect(imageMimeType('images/a.xyz')).toBeNull();
  });
});
