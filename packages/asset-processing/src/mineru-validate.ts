import { MineruClientError } from './mineru-client';
import { locateMineruOutput, MINERU_MD_FILENAME } from './mineru-zip';
import type { MineruZipEntry } from './mineru-zip';

/**
 * MinerU 解包条目的白名单校验（ADR-0026 决定 3：禁止绝对路径、`..`、
 * 符号链接和未声明文件）。
 *
 * `unpackMineruZip` 只保证容器结构安全，这里决定哪些条目能进入派生存储：
 * 先按真实 zip 布局（`<base>/<parse_dir>/<base>.md` + `<base>/<parse_dir>/
 * images/`，G2 真 GPU canary 实测对齐）定位 markdown，再保留该前缀下
 * `images/` 平铺单层的白名单图片；辅助产物（content_list.json 等）不是
 * 用户选择的资料，直接忽略。任何非法路径（穿越、绝对路径、伪装分隔符）
 * 或该前缀外的条目都让整个结果失败——md 若引用到被丢弃的图片必然悬空，
 * 明确失败比留下破损的派生表示好，且不静默遗漏用户选择的资料。
 *
 * 输出归一化为派生存储路径：markdown → `index.md`、图片 → `images/<file>`
 * （与 C3 落盘、manifest、D 阶段鉴权路由的存储布局一致），zip 内部布局
 * 不泄漏到下游。
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
 * 图片条目白名单：`images/` 平铺单层下的单段文件名、无子目录、扩展名白名单。
 * 调用方已保证条目在 `<base>/<parse_dir>/` 前缀内。
 */
function isAllowedImageName(name: string): boolean {
  const rest = name.slice('images/'.length);
  if (!rest || rest.includes('/')) return false;
  const extension = rest.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension);
}

/** 校验通过的派生内容：归一化的 markdown 与白名单图片（zip 条目顺序）。 */
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
  const layout = locateMineruOutput(entries);
  if (!layout) throw invalid();
  const prefix = `${layout.base}/${layout.parseDir}/`;
  const images: MineruZipEntry[] = [];
  for (const entry of entries) {
    if (!isSafeZipPath(entry.name)) {
      throw invalid({ entry: entry.name });
    }
    /* 全部条目必须共享同一 <base>/<parse_dir>/ 前缀：一次任务一个文件。 */
    if (!entry.name.startsWith(prefix)) {
      throw invalid({ entry: entry.name });
    }
    if (entry === layout.markdown) continue;
    const rest = entry.name.slice(prefix.length);
    if (rest.startsWith('images/')) {
      if (!isAllowedImageName(rest)) {
        throw invalid({ entry: entry.name });
      }
      /* 归一化为派生存储相对路径（C3 落盘直接可用）。 */
      images.push({ name: rest, bytes: entry.bytes });
    }
    /* 前缀下其他条目（content_list*.json 等）是辅助产物，忽略。 */
  }
  return {
    markdown: { name: MINERU_MD_FILENAME, bytes: layout.markdown.bytes },
    images,
  };
}

/**
 * 图片条目的标准 MIME（manifest 记录用）。未知扩展名返回 null。
 */
export function imageMimeType(name: string): string | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MIME_TYPES[extension] ?? null;
}
