import { inflateRawSync } from 'node:zlib';
import { MineruClientError } from './mineru-client';
import { MINERU_RESULT_MAX_BYTES } from './mineru-client';
import { ASSET_TEXT_MAX_CHARACTERS } from './text-extraction';

/**
 * MinerU 结果 zip 的安全解包（ADR-0026 决定 3 的上界）。
 *
 * `unpackMineruZip` 解出全部条目（含 index.md 与 images/），每条目只保留
 * 受控相对路径与解压后的字节；条目数、单条目字节、总字节全部限死，任何
 * 越界视为结果损坏（`mineru_result_invalid`），由编排层降级，不静默遗漏
 * 用户选择的资料。`readMineruMarkdown` 是它的薄包装：只取 index.md 作
 * Agent 上下文文本。
 *
 * zip64（偏移/条目数走扩展头）直接拒绝：结果上限 512MB 不可能触发 4GB
 * 偏移，出现 zip64 字段说明容器异常。不校验 CRC32——内容完整性由上层
 * 对象存储的 SHA-256 承担。
 */

/** 容器允许的条目总数上限（含 index.md 与图片）。 */
export const MINERU_ZIP_MAX_ENTRIES = 200;

/**
 * 单条目解压后的字节上限。MinerU 单页图片通常远小于此，128MiB 是防御性
 * 上界：超过即明确失败，防止单个 inflate 条目放大成内存炸弹。
 */
export const MINERU_ZIP_MAX_ENTRY_BYTES = 128 * 1024 * 1024;

/**
 * 全部条目解压后的总字节上限，与容器下载上限一致：压缩容器 512MB 内不
 * 允许解压出超过容器容量的总和（inflate 放大被双重封顶）。
 */
export const MINERU_ZIP_MAX_TOTAL_BYTES = MINERU_RESULT_MAX_BYTES;

/** 解包后的一个条目：受控相对路径（C 阶段再做白名单校验）与解压字节。 */
export type MineruZipEntry = { name: string; bytes: Uint8Array };

/** 可选覆盖的上界（测试传小值，生产用默认常量）。 */
export type MineruZipLimits = {
  maxEntries?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
};

/**
 * 派生存储中的 Markdown 文件名（worker 落盘与 manifest 记录用，固定不随
 * 输入变化）。注意这不是 MinerU 结果 zip 内的文件名——zip 内是
 * `<base>/<parse_dir>/<base>.md`（见 locateMineruOutput），落盘时归一化。
 */
export const MINERU_MD_FILENAME = 'index.md';

/** md 文本字节上限：与字符上限一致，UTF-8 最坏 4 字节/码点。 */
const MINERU_MD_MAX_UTF8_BYTES = ASSET_TEXT_MAX_CHARACTERS * 4;

const EOCD_SIGNATURE = 0x06054b50;
const CD_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const CD_ENTRY_MIN_LENGTH = 46;
const LOCAL_HEADER_MIN_LENGTH = 30;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

function invalid(cause?: unknown): MineruClientError {
  return new MineruClientError('mineru_result_invalid', { cause });
}

/** 从尾部向前找 EOCD（zip 注释最长 65535 字节，只扫描尾部窗口）。 */
function findEocdOffset(view: DataView, byteLength: number): number | null {
  const searchStart = Math.max(0, byteLength - EOCD_MIN_LENGTH - 0xffff);
  for (let i = byteLength - EOCD_MIN_LENGTH; i >= searchStart; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return null;
}

/**
 * 安全解包 MinerU 结果 zip 的全部条目。
 *
 * 纯函数：不做网络、不读对象存储。失败一律抛 `MineruClientError`
 * （`mineru_result_invalid`），调用方据此决定降级还是终止。
 */
export function unpackMineruZip(
  bytes: Uint8Array,
  limits: MineruZipLimits = {},
): MineruZipEntry[] {
  const maxEntries = limits.maxEntries ?? MINERU_ZIP_MAX_ENTRIES;
  const maxEntryBytes = limits.maxEntryBytes ?? MINERU_ZIP_MAX_ENTRY_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? MINERU_ZIP_MAX_TOTAL_BYTES;

  if (bytes.byteLength < EOCD_MIN_LENGTH) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocdOffset(view, bytes.byteLength);
  if (eocd === null) throw invalid();

  const totalEntries = view.getUint16(eocd + 10, true);
  /* 0xFFFF 是 zip64 哨兵；超过上限同样直接拒绝。 */
  if (totalEntries === 0xffff || totalEntries > maxEntries) {
    throw invalid({ entries: totalEntries });
  }
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff) throw invalid();
  if (cdOffset + EOCD_MIN_LENGTH > bytes.byteLength) throw invalid();

  /* 遍历 central directory，逐条解出条目（46 字节定长头 + 变长字段）。 */
  const entries: MineruZipEntry[] = [];
  let cursor = cdOffset;
  let totalBytes = 0;
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + CD_ENTRY_MIN_LENGTH > bytes.byteLength) throw invalid();
    if (view.getUint32(cursor, true) !== CD_SIGNATURE) throw invalid();
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const entryEnd =
      cursor + CD_ENTRY_MIN_LENGTH + nameLength + extraLength + commentLength;
    if (entryEnd > bytes.byteLength) throw invalid();
    const nameBytes = bytes.slice(
      cursor + CD_ENTRY_MIN_LENGTH,
      cursor + CD_ENTRY_MIN_LENGTH + nameLength,
    );
    /* fatal 解码：非 UTF-8 文件名视为结果损坏。 */
    const name = decodeUtf8(nameBytes);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const localOffset = view.getUint32(cursor + 42, true);

    /* 用 local header 定位数据区：local 头 30 字节 + 自己的文件名/扩展长。 */
    if (localOffset === 0xffffffff) throw invalid();
    if (localOffset + LOCAL_HEADER_MIN_LENGTH > bytes.byteLength) {
      throw invalid();
    }
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw invalid();
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart =
      localOffset +
      LOCAL_HEADER_MIN_LENGTH +
      localNameLength +
      localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength) throw invalid();

    let raw: Uint8Array;
    if (method === METHOD_STORED) {
      raw = bytes.slice(dataStart, dataEnd);
    } else if (method === METHOD_DEFLATE) {
      try {
        /* inflateRawSync 返回 Buffer（Uint8Array 子类），归一为纯 Uint8Array。 */
        raw = new Uint8Array(inflateRawSync(bytes.slice(dataStart, dataEnd)));
      } catch (cause) {
        throw invalid(cause);
      }
    } else {
      throw invalid({ method });
    }
    /* 单条目与累计双重封顶，防 zip 炸弹（容器内 inflate 放大）。 */
    if (raw.byteLength > maxEntryBytes) {
      throw invalid({ entry: name, entryBytes: raw.byteLength });
    }
    totalBytes += raw.byteLength;
    if (totalBytes > maxTotalBytes) throw invalid({ totalBytes });

    entries.push({ name, bytes: raw });
    cursor = entryEnd;
  }
  return entries;
}

/**
 * 解码 index.md 条目为 Agent 上下文文本。
 *
 * 与容器解析解耦（C3 起 worker 用解包+校验+本函数，不必为取文本而重复
 * 解包整个 zip）。失败一律抛 `MineruClientError`（`mineru_result_invalid`）。
 */
export function decodeMineruMarkdown(bytes: Uint8Array): string {
  /* md 有更紧的字节上限（480KB），在条目级上限之上再收一道。 */
  if (bytes.byteLength > MINERU_MD_MAX_UTF8_BYTES) throw invalid();

  let decoded: string;
  try {
    decoded = decodeUtf8(bytes);
  } catch (cause) {
    throw invalid(cause);
  }
  const normalized = decoded.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  /* 空 md 视同结果损坏：降级路径会兜底出文本，不产生空正文。 */
  if (!normalized) throw invalid();
  return [...normalized].slice(0, ASSET_TEXT_MAX_CHARACTERS).join('');
}

/**
 * 识别 MinerU 结果 zip 的派生布局。
 *
 * 真实 API（3.4.4 实测）的 zip 条目由 `build_zip_arcname` 生成，形状固定
 * 为 `<base>/<parse_dir>/<base>.md`：base = 提交的原始文件名 stem，
 * parse_dir = office / vlm / hybrid_<method> / <method>（随服务端后端与
 * 解析方式变化，见 MinerU cli/output_paths.py 的 build_parse_dir）。
 * 旧假设的根级 `index.md` 与真实服务不符（G2 真 GPU canary 实测暴露）。
 *
 * 识别规则（保守）：恰好一个 md 条目，路径三节均为单段，且文件名 stem
 * 与 base 一致；parse_dir 不枚举（供应商会演进），单段即可。不符合或
 * md 多个 → null，由调用方判结果损坏。
 */
export type MineruOutputLayout = {
  base: string;
  parseDir: string;
  markdown: MineruZipEntry;
};

export function locateMineruOutput(
  entries: MineruZipEntry[],
): MineruOutputLayout | null {
  let found: MineruOutputLayout | null = null;
  for (const entry of entries) {
    const parts = entry.name.split('/');
    if (parts.length !== 3) continue;
    const [base, parseDir, file] = parts;
    if (!base || !parseDir || !file || !file.endsWith('.md')) continue;
    /* 文件名必须为 <base>.md：stem 与顶层目录一致，防伪装目录下的 md。 */
    if (file.slice(0, -3) !== base) continue;
    if (found) return null;
    found = { base, parseDir, markdown: entry };
  }
  return found;
}

/**
 * 从已下载的 MinerU 结果 zip 中读取 Markdown 文本（布局识别后解码）。
 *
 * 纯函数：不做网络、不读对象存储。失败一律抛 `MineruClientError`
 * （`mineru_result_invalid`），调用方据此决定降级还是终止。
 */
export function readMineruMarkdown(bytes: Uint8Array): string {
  const layout = locateMineruOutput(unpackMineruZip(bytes));
  if (!layout) throw invalid();
  return decodeMineruMarkdown(layout.markdown.bytes);
}

/** fatal 模式：文件名或内容非 UTF-8 必须报错，不静默替换。 */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
