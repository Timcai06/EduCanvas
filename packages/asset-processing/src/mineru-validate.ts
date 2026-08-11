import { MineruClientError } from './mineru-client';
import { MINERU_MD_FILENAME } from './mineru-zip';
import type { MineruZipEntry } from './mineru-zip';

/**
 * MinerU 解包条目的白名单校验（ADR-0026 决定 3：禁止绝对路径、`..`、
 * 符号链接和未声明文件）。
 *
 * `unpackMineruZip` 只保证容器结构安全，这里决定哪些条目能进入派生存储：
 * 只保留根级 `index.md` 与 `images/` 平铺单层下的白名单图片；根级辅助
 * 产物（content_list.json、layout.pdf 等）不是用户选择的资料，直接忽略。
 * 任何非法路径（穿越、绝对路径、伪装分隔符）或 images/ 下的未声明文件
 * 都让整个结果失败——md 若引用到被丢弃的图片必然悬空，明确失败比留下
 * 破损的派生表示好，且不静默遗漏用户选择的资料。
 *
 * svg 排除在白名单外：SVG 是可执行脚本载体，与 Canvas 分层信任模型
 * （ADR-0004/ADR-0009）冲突，即使 <img> 加载不执行脚本也不引入。
 */

/** images/ 下允许的图片扩展名（小写比较）。 */
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

const IMAGE_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

function invalid(cause?: unknown): MineruClientError {
  return new MineruClientError('mineru_result_invalid', { cause });
}

/**
 * 路径安全性：非空、无绝对路径（/ 或盘符）、无反斜杠/NUL、无 `.`/`..`
 * 路径段。zip 条目名来自供应商容器，按不可信输入处理。
 */
function isSafeZipPath(name: string): boolean {
  if (!name) return false;
  if (name.startsWith('/') || name.startsWith('\\')) return false;
  if (name.includes('\\') || name.includes('\0')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  for (const segment of name.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') return false;
  }
  return true;
}

/**
 * images/ 平铺单层下的白名单图片：单段文件名、无子目录、扩展名白名单。
 */
function isAllowedImageName(name: string): boolean {
  const rest = name.slice('images/'.length);
  if (!rest || rest.includes('/')) return false;
  const extension = rest.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension);
}

/** 校验通过的派生内容：根级 index.md 与白名单图片（zip 条目顺序）。 */
export type MineruExtracted = {
  markdown: MineruZipEntry;
  images: MineruZipEntry[];
};

/**
 * 校验解包条目，产出允许进入派生存储的内容。
 *
 * 纯函数。失败一律抛 `MineruClientError`（`mineru_result_invalid`）。
 */
export function validateMineruEntries(
  entries: MineruZipEntry[],
): MineruExtracted {
  let markdown: MineruZipEntry | undefined;
  const images: MineruZipEntry[] = [];
  for (const entry of entries) {
    if (!isSafeZipPath(entry.name)) {
      throw invalid({ entry: entry.name });
    }
    if (entry.name === MINERU_MD_FILENAME) {
      markdown = entry;
    } else if (entry.name.startsWith('images/')) {
      if (!isAllowedImageName(entry.name)) {
        throw invalid({ entry: entry.name });
      }
      images.push(entry);
    }
    /* 根级其他条目（content_list.json 等）是辅助产物，忽略。 */
  }
  if (!markdown) throw invalid();
  return { markdown, images };
}

/**
 * 图片条目的标准 MIME（manifest 记录用）。未知扩展名返回 null。
 */
export function imageMimeType(name: string): string | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME_TYPES[extension] ?? null;
}
