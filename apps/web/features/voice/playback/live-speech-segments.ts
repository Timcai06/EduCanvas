const SENTENCE_END = /[。！？!?；;：:\n]/u;
const SOFT_BREAK = /[，、,]/u;

export interface LiveSpeechSegmentBatch {
  readonly segments: readonly LiveSpeechSegment[];
  /** 已经安全交给 TTS 队列的原始文本字符数。 */
  readonly consumedCharacters: number;
}

export interface LiveSpeechSegment {
  readonly text: string;
  readonly startCursor: number;
  readonly endCursor: number;
}

function preferredBoundary(
  text: string,
  minimum: number,
  maximum: number,
): number | null {
  const upper = Math.min(text.length, maximum);
  for (let index = 0; index < upper; index += 1) {
    if (SENTENCE_END.test(text[index]!)) return index + 1;
  }
  if (text.length < maximum && text.length < Math.max(24, minimum)) return null;
  for (let index = upper - 1; index >= minimum; index -= 1) {
    if (SOFT_BREAK.test(text[index]!) || /\s/u.test(text[index]!)) {
      return index + 1;
    }
  }
  return text.length >= maximum ? upper : null;
}

/**
 * 从单调追加的 Assistant 文本中提取可立即播报的语义段。
 *
 * 首段更短以缩短首音等待，后续段稍长以维持 CosyVoice 韵律；未闭合的尾句
 * 只有在 Turn 完成时才冲刷，避免把半句话读出去。返回值使用原始字符偏移，
 * Markdown 清洗发生在入 TTS 前，不会破坏增量游标。
 */
export function takeLiveSpeechSegments(input: {
  readonly text: string;
  readonly consumedCharacters: number;
  readonly segmentCount: number;
  readonly complete: boolean;
}): LiveSpeechSegmentBatch {
  if (
    input.consumedCharacters < 0 ||
    input.consumedCharacters > input.text.length
  ) {
    return { segments: [], consumedCharacters: 0 };
  }
  const segments: LiveSpeechSegment[] = [];
  let cursor = input.consumedCharacters;
  let segmentCount = input.segmentCount;
  while (cursor < input.text.length) {
    const remainder = input.text.slice(cursor);
    const first = segmentCount === 0;
    const minimum = first ? 10 : 18;
    const maximum = first ? 32 : 72;
    const boundary = preferredBoundary(remainder, minimum, maximum);
    if (boundary === null) {
      if (!input.complete) break;
      const tail = remainder.trim();
      if (tail) {
        segments.push({
          text: tail,
          startCursor: cursor,
          endCursor: input.text.length,
        });
      }
      cursor = input.text.length;
      break;
    }
    const startCursor = cursor;
    const raw = remainder.slice(0, boundary);
    const segment = raw.trim();
    cursor += boundary;
    if (!segment) continue;
    segments.push({ text: segment, startCursor, endCursor: cursor });
    segmentCount += 1;
  }
  return { segments, consumedCharacters: cursor };
}
