import { inflateRawSync } from 'node:zlib';
import { MineruClientError } from './mineru-client';
import { ASSET_TEXT_MAX_CHARACTERS } from './text-extraction';

/**
 * MinerU 结果 zip 的最小安全读取（ADR-0026 决定 3 的上界前置）。
 *
 * 只读 `index.md` 一个条目：它是 Agent 上下文的文本来源。完整解包
 * （images/、content_list、manifest）在 C 阶段补齐，这里先建立
 * 有界性——条目数、解压后字节数、容器偏移全部限死，任何越界视为
 * 结果损坏（`mineru_result_invalid`），由编排层降级。
 *
 * zip64（偏移/条目数走扩展头）直接拒绝：结果上限 512MB 不可能触发
 * 4GB 偏移，出现 zip64 字段说明容器异常。不校验 CRC32——内容完整性
 * 由上层对象存储的 SHA-256 承担。
 */

/** 容器允许的条目总数上限（含 index.md 与图片）。 */
export const MINERU_ZIP_MAX_ENTRIES = 200;

/** MinerU 输出的 Markdown 文件名（固定，不随输入文件名变化）。 */
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
 * 从已下载的 MinerU 结果 zip 中读取 `index.md` 文本。
 *
 * 纯函数：不做网络、不读对象存储。失败一律抛 `MineruClientError`
 * （`mineru_result_invalid`），调用方据此决定降级还是终止。
 */
export function readMineruMarkdown(bytes: Uint8Array): string {
  if (bytes.byteLength < EOCD_MIN_LENGTH) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocdOffset(view, bytes.byteLength);
  if (eocd === null) throw invalid();

  const totalEntries = view.getUint16(eocd + 10, true);
  /* 0xFFFF 是 zip64 哨兵；超过上限同样直接拒绝。 */
  if (totalEntries === 0xffff || totalEntries > MINERU_ZIP_MAX_ENTRIES) {
    throw invalid({ entries: totalEntries });
  }
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff) throw invalid();
  if (cdOffset + EOCD_MIN_LENGTH > bytes.byteLength) throw invalid();

  /* 遍历 central directory 找 index.md（46 字节定长头 + 变长字段）。 */
  let cursor = cdOffset;
  let found: {
    method: number;
    compressedSize: number;
    localOffset: number;
  } | null = null;
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
    if (decodeUtf8(nameBytes) === MINERU_MD_FILENAME) {
      found = {
        method: view.getUint16(cursor + 10, true),
        compressedSize: view.getUint32(cursor + 20, true),
        localOffset: view.getUint32(cursor + 42, true),
      };
      break;
    }
    cursor = entryEnd;
  }
  if (found === null) throw invalid();

  /* 用 local header 定位数据区：local 头 30 字节 + 自己的文件名/扩展长。 */
  const localStart = found.localOffset;
  if (localStart + LOCAL_HEADER_MIN_LENGTH > bytes.byteLength) throw invalid();
  if (view.getUint32(localStart, true) !== LOCAL_SIGNATURE) throw invalid();
  const localNameLength = view.getUint16(localStart + 26, true);
  const localExtraLength = view.getUint16(localStart + 28, true);
  const dataStart =
    localStart + LOCAL_HEADER_MIN_LENGTH + localNameLength + localExtraLength;
  const dataEnd = dataStart + found.compressedSize;
  if (dataEnd > bytes.byteLength) throw invalid();

  let raw: Uint8Array;
  if (found.method === METHOD_STORED) {
    raw = bytes.slice(dataStart, dataEnd);
  } else if (found.method === METHOD_DEFLATE) {
    try {
      raw = inflateRawSync(bytes.slice(dataStart, dataEnd));
    } catch (cause) {
      throw invalid(cause);
    }
  } else {
    throw invalid({ method: found.method });
  }
  /* 解压后仍受字节上限约束，防止 zip 炸弹（容器内 inflate 放大）。 */
  if (raw.byteLength > MINERU_MD_MAX_UTF8_BYTES) throw invalid();

  let decoded: string;
  try {
    decoded = decodeUtf8(raw);
  } catch (cause) {
    throw invalid(cause);
  }
  const normalized = decoded.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  /* 空 md 视同结果损坏：降级路径会兜底出文本，不产生空正文。 */
  if (!normalized) throw invalid();
  return [...normalized].slice(0, ASSET_TEXT_MAX_CHARACTERS).join('');
}

/** fatal 模式：文件名或内容非 UTF-8 必须报错，不静默替换。 */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
