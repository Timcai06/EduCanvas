import { describe, expect, it } from 'vitest';
import { MINERU_MD_FILENAME } from './mineru-zip';
import { imageMimeType, validateMineruEntries } from './mineru-validate';
import type { MineruZipEntry } from './mineru-zip';

const utf8 = (value: string) => new TextEncoder().encode(value);

function entry(name: string, data?: Uint8Array): MineruZipEntry {
  return { name, bytes: data ?? utf8('x') };
}

function withMd(extra: MineruZipEntry[]): MineruZipEntry[] {
  return [entry(MINERU_MD_FILENAME, utf8('# 正文')), ...extra];
}

describe('validateMineruEntries', () => {
  it('index.md 与白名单图片保留，根级辅助产物忽略', () => {
    const result = validateMineruEntries(
      withMd([
        entry('images/001.jpg', new Uint8Array([0xff, 0xd8])),
        entry('content_list.json', utf8('[]')),
        entry('layout.pdf', utf8('%PDF')),
      ]),
    );

    expect(result.markdown.name).toBe(MINERU_MD_FILENAME);
    expect(result.images.map((i) => i.name)).toEqual(['images/001.jpg']);
  });

  it('多种白名单图片扩展名全部保留（大小写不敏感）', () => {
    const result = validateMineruEntries(
      withMd([
        entry('images/a.jpeg'),
        entry('images/b.PNG'),
        entry('images/c.gif'),
        entry('images/d.webp'),
        entry('images/e.bmp'),
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

  it('缺 index.md 视为结果损坏', () => {
    expect(() => validateMineruEntries([entry('images/001.jpg')])).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('index.md 带路径分量（images/index.md）不匹配根文件', () => {
    expect(() =>
      validateMineruEntries([
        entry('images/index.md'),
        entry('images/001.jpg'),
      ]),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('.. 路径穿越条目明确失败（不静默丢弃）', () => {
    expect(() => validateMineruEntries(withMd([entry('../evil.txt')]))).toThrow(
      expect.objectContaining({ code: 'mineru_result_invalid' }),
    );
  });

  it('images/ 下的 .. 穿越明确失败', () => {
    expect(() =>
      validateMineruEntries(withMd([entry('images/../evil.jpg')])),
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
      validateMineruEntries(withMd([entry('images\\evil.jpg')])),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('images/ 下非白名单扩展名明确失败（引用会悬空，不能静默遗漏）', () => {
    for (const name of ['images/a.tif', 'images/a.txt', 'images/a.html']) {
      expect(() => validateMineruEntries(withMd([entry(name)]))).toThrow(
        expect.objectContaining({ code: 'mineru_result_invalid' }),
      );
    }
  });

  it('svg 排除白名单（可执行脚本载体，违反分层信任）', () => {
    expect(() =>
      validateMineruEntries(withMd([entry('images/a.svg')])),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('images/ 嵌套子目录明确失败（只接受平铺单层）', () => {
    expect(() =>
      validateMineruEntries(withMd([entry('images/sub/a.jpg')])),
    ).toThrow(expect.objectContaining({ code: 'mineru_result_invalid' }));
  });

  it('只有 index.md 时图片列表为空', () => {
    const result = validateMineruEntries([entry(MINERU_MD_FILENAME)]);

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
