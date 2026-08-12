export interface SpeechUnsafeRange {
  readonly start: number;
  readonly end: number;
}

export interface SpeechSafetyRanges {
  readonly noCut: readonly SpeechUnsafeRange[];
  readonly strip: readonly SpeechUnsafeRange[];
}

function appendRange(
  noCut: SpeechUnsafeRange[],
  strip: SpeechUnsafeRange[],
  start: number,
  end: number,
  stripStart = start,
): void {
  noCut.push({ start, end });
  strip.push({ start: stripStart, end });
}

/**
 * Locate streamed syntax that must never be split or spoken literally.
 * Unclosed constructs extend to the current text end so a partial delta is
 * held until later text either closes it or the Turn completes.
 */
export function findSpeechSafetyRanges(text: string): SpeechSafetyRanges {
  const noCut: SpeechUnsafeRange[] = [];
  const strip: SpeechUnsafeRange[] = [];
  let index = 0;

  while (index < text.length) {
    if (text.startsWith('```', index)) {
      const closing = text.indexOf('```', index + 3);
      const end = closing === -1 ? text.length : closing + 3;
      appendRange(noCut, strip, index, end);
      index = end;
      continue;
    }

    if (text[index] === '`') {
      const closing = text.indexOf('`', index + 1);
      const end = closing === -1 ? text.length : closing + 1;
      appendRange(noCut, strip, index, end);
      index = end;
      continue;
    }

    const mathDelimiter = text.startsWith('$$', index)
      ? { close: '$$', width: 2 }
      : text.startsWith('\\[', index)
        ? { close: '\\]', width: 2 }
        : text.startsWith('\\(', index)
          ? { close: '\\)', width: 2 }
          : text[index] === '$' && (index === 0 || text[index - 1] !== '\\')
            ? { close: '$', width: 1 }
            : null;
    if (mathDelimiter) {
      const closing = text.indexOf(
        mathDelimiter.close,
        index + mathDelimiter.width,
      );
      const end =
        closing === -1 ? text.length : closing + mathDelimiter.close.length;
      appendRange(noCut, strip, index, end);
      index = end;
      continue;
    }

    const image = text.startsWith('![', index);
    if (image || text[index] === '[') {
      const labelStart = index + (image ? 2 : 1);
      const labelEnd = text.indexOf(']', labelStart);
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const closing = text.indexOf(')', labelEnd + 2);
        const end = closing === -1 ? text.length : closing + 1;
        appendRange(noCut, strip, index, end, image ? index : labelEnd + 1);
        index = end;
        continue;
      }
    }

    if (
      text.startsWith('http://', index) ||
      text.startsWith('https://', index)
    ) {
      let end = index;
      while (
        end < text.length &&
        /[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]/u.test(text[end]!)
      ) {
        end += 1;
      }
      appendRange(noCut, strip, index, end);
      index = end;
      continue;
    }

    if (text[index] === '{') {
      let end = index + 1;
      let depth = 1;
      let inString = false;
      let escaped = false;
      while (end < text.length && depth > 0) {
        const character = text[end]!;
        if (inString) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') inString = false;
        } else if (character === '"') inString = true;
        else if (character === '{') depth += 1;
        else if (character === '}') depth -= 1;
        end += 1;
      }
      if (depth === 0 || end === text.length) {
        appendRange(noCut, strip, index, end);
        index = end;
        continue;
      }
    }

    index += 1;
  }

  return { noCut, strip };
}

export function isSpeechCutSafe(
  position: number,
  noCut: readonly SpeechUnsafeRange[],
): boolean {
  return !noCut.some((range) => position > range.start && position < range.end);
}

export function stripUnsafeSpeechContent(
  text: string,
  strip: readonly SpeechUnsafeRange[],
  offset: number,
): string {
  let cursor = 0;
  let result = '';
  for (const range of strip) {
    const start = Math.max(0, range.start - offset);
    const end = Math.min(text.length, range.end - offset);
    if (end <= 0 || start >= text.length) continue;
    result += text.slice(cursor, Math.max(cursor, start));
    cursor = Math.max(cursor, end);
  }
  return result + text.slice(cursor);
}
