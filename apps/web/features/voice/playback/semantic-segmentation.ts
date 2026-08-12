const SENTENCE_END = /[。！？.!?；;：:\n]/u;
const SOFT_BREAK = /[，、,]/u;
const ABBREVIATION_WORDS = new Set([
  'Mr',
  'Mrs',
  'Ms',
  'Dr',
  'Prof',
  'Sr',
  'Jr',
  'Inc',
  'Ltd',
  'Corp',
  'etc',
  'vs',
  'approx',
  'dept',
  'est',
  'vol',
]);

interface UnsafeRange {
  readonly start: number;
  readonly end: number;
}

export interface SemanticSegment {
  readonly text: string;
  readonly startCursor: number;
  readonly endCursor: number;
}

export interface SemanticSegmentBatch {
  readonly segments: readonly SemanticSegment[];
  readonly consumedCharacters: number;
}

export interface SemanticSegmentInput {
  readonly text: string;
  readonly consumedCharacters: number;
  readonly segmentCount: number;
  readonly complete: boolean;
  readonly nowMs: number;
  readonly lastCommittedAtMs: number;
}

interface RangeSet {
  readonly noCut: readonly UnsafeRange[];
  readonly strip: readonly UnsafeRange[];
}

function findRanges(text: string): RangeSet {
  const noCut: UnsafeRange[] = [];
  const strip: UnsafeRange[] = [];
  let i = 0;

  while (i < text.length) {
    // Fenced code block ```...```
    if (text.startsWith('```', i)) {
      const end = text.indexOf('```', i + 3);
      if (end !== -1) {
        const range = { start: i, end: end + 3 };
        noCut.push(range);
        strip.push(range);
        i = end + 3;
        continue;
      }
      const range = { start: i, end: text.length };
      noCut.push(range);
      strip.push(range);
      break;
    }

    // Inline code `...`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        const range = { start: i, end: end + 1 };
        noCut.push(range);
        strip.push(range);
        i = end + 1;
        continue;
      }
    }

    // Display math $$...$$
    if (text.startsWith('$$', i)) {
      const end = text.indexOf('$$', i + 2);
      if (end !== -1) {
        const range = { start: i, end: end + 2 };
        noCut.push(range);
        strip.push(range);
        i = end + 2;
        continue;
      }
    }

    // Bracket math \[...\]
    if (text.startsWith('\\[', i)) {
      const end = text.indexOf('\\]', i + 2);
      if (end !== -1) {
        const range = { start: i, end: end + 2 };
        noCut.push(range);
        strip.push(range);
        i = end + 2;
        continue;
      }
    }

    // Inline math $...$
    if (text[i] === '$' && (i === 0 || text[i - 1] !== '\\')) {
      const end = text.indexOf('$', i + 1);
      if (end !== -1 && end - i < 200) {
        const range = { start: i, end: end + 1 };
        noCut.push(range);
        strip.push(range);
        i = end + 1;
        continue;
      }
    }

    // Paren math \(...\)
    if (text.startsWith('\\(', i)) {
      const end = text.indexOf('\\)', i + 2);
      if (end !== -1) {
        const range = { start: i, end: end + 2 };
        noCut.push(range);
        strip.push(range);
        i = end + 2;
        continue;
      }
    }

    // Image ![alt](url)
    if (text.startsWith('![', i)) {
      const bracketEnd = text.indexOf(']', i + 2);
      if (bracketEnd !== -1 && text[bracketEnd + 1] === '(') {
        const parenEnd = text.indexOf(')', bracketEnd + 2);
        if (parenEnd !== -1) {
          const range = { start: i, end: parenEnd + 1 };
          noCut.push(range);
          strip.push(range);
          i = parenEnd + 1;
          continue;
        }
      }
    }

    // Markdown link [label](url) — noCut covers full link, strip only covers (url)
    if (text[i] === '[') {
      const bracketEnd = text.indexOf(']', i + 1);
      if (bracketEnd !== -1 && text[bracketEnd + 1] === '(') {
        const parenEnd = text.indexOf(')', bracketEnd + 2);
        if (parenEnd !== -1) {
          noCut.push({ start: i, end: parenEnd + 1 });
          strip.push({ start: bracketEnd + 1, end: parenEnd + 1 });
          i = parenEnd + 1;
          continue;
        }
      }
    }

    // Bare URL
    if (text.startsWith('http://', i) || text.startsWith('https://', i)) {
      let end = i;
      while (end < text.length && !/\s/u.test(text[end]!)) {
        end++;
      }
      const range = { start: i, end };
      noCut.push(range);
      strip.push(range);
      i = end;
      continue;
    }

    // JSON object
    if (text[i] === '{') {
      let end = i + 1;
      let depth = 1;
      while (end < text.length && depth > 0) {
        if (text[end] === '{') depth++;
        if (text[end] === '}') depth--;
        end++;
      }
      if (depth === 0 && end - i < 2000) {
        const range = { start: i, end };
        noCut.push(range);
        strip.push(range);
        i = end;
        continue;
      }
    }

    i++;
  }

  return { noCut, strip };
}

function isSafeToCutBefore(
  pos: number,
  noCut: readonly UnsafeRange[],
): boolean {
  for (const range of noCut) {
    if (pos > range.start && pos < range.end) {
      return false;
    }
  }
  return true;
}

function isAbbreviationBefore(text: string, pos: number): boolean {
  const wordEnd = pos;
  let wordStart = pos - 1;
  while (wordStart >= 0 && /[a-zA-Z]/.test(text[wordStart]!)) {
    wordStart--;
  }
  wordStart++;
  const word = text.slice(wordStart, wordEnd);
  return ABBREVIATION_WORDS.has(word);
}

function isSentenceEnd(text: string, pos: number): boolean {
  if (pos < 0 || pos >= text.length) return false;
  if (!SENTENCE_END.test(text[pos]!)) return false;
  if (isAbbreviationBefore(text, pos)) return false;
  // Decimal point: digit immediately before AND after the period → not a sentence end.
  if (
    pos > 0 &&
    pos + 1 < text.length &&
    /\d/u.test(text[pos - 1]!) &&
    /\d/u.test(text[pos + 1]!)
  )
    return false;
  return true;
}

function findBestBoundary(
  text: string,
  start: number,
  minimum: number,
  maximum: number,
  noCut: readonly UnsafeRange[],
): number | null {
  const upper = Math.min(text.length, start + maximum);

  // 1) Sentence ends
  for (let i = start + minimum; i < upper; i++) {
    if (isSentenceEnd(text, i) && isSafeToCutBefore(i + 1, noCut)) {
      return i + 1;
    }
  }

  // 2) Soft breaks / whitespace (prefer later)
  for (let i = upper - 1; i >= start + minimum; i--) {
    if (
      (SOFT_BREAK.test(text[i]!) || /\s/u.test(text[i]!)) &&
      isSafeToCutBefore(i + 1, noCut)
    ) {
      return i + 1;
    }
  }

  // 3) Unsafe range boundaries
  for (const range of noCut) {
    if (range.end > start + minimum && range.end <= upper) {
      return range.end;
    }
  }

  return null;
}

/**
 * Strip characters that fall within any strip range.
 * `offset` is the cursor position in the original text where this slice starts,
 * so strip ranges (which use original-text positions) can be adjusted.
 */
function stripUnsafeContent(
  text: string,
  strip: readonly UnsafeRange[],
  offset: number,
): string {
  if (strip.length === 0) return text;

  const excluded = new Set<number>();
  for (const range of strip) {
    const relStart = Math.max(0, range.start - offset);
    const relEnd = Math.min(text.length, range.end - offset);
    for (let j = relStart; j < relEnd; j++) {
      excluded.add(j);
    }
  }

  let result = '';
  for (let j = 0; j < text.length; j++) {
    if (!excluded.has(j)) {
      result += text[j];
    }
  }
  return result;
}

/**
 * Find the furthest position to release when no natural boundary exists.
 * Walks backward from `limit` looking for any safe position.
 */
function findEmergencyReleasePosition(
  text: string,
  start: number,
  limit: number,
  noCut: readonly UnsafeRange[],
): number | null {
  for (let pos = limit; pos > start; pos--) {
    if (isSafeToCutBefore(pos, noCut)) {
      return pos;
    }
  }
  return null;
}

export function takeSemanticSpeechSegments(
  input: SemanticSegmentInput,
): SemanticSegmentBatch {
  const {
    text,
    consumedCharacters,
    segmentCount,
    complete,
    nowMs,
    lastCommittedAtMs,
  } = input;

  if (consumedCharacters < 0 || consumedCharacters > text.length) {
    return { segments: [], consumedCharacters: 0 };
  }

  const ranges = findRanges(text);
  const segments: SemanticSegment[] = [];
  let cursor = consumedCharacters;
  let currentSegmentCount = segmentCount;

  while (cursor < text.length) {
    const first = currentSegmentCount === 0;
    // Lower minimums allow short complete sentences to release quickly.
    const minimum = first ? 4 : 8;
    const maximum = first ? 40 : 80;

    const boundary = findBestBoundary(
      text,
      cursor,
      minimum,
      maximum,
      ranges.noCut,
    );

    if (boundary !== null) {
      const raw = text.slice(cursor, boundary);
      const clean = stripUnsafeContent(raw, ranges.strip, cursor).trim();
      if (clean) {
        segments.push({
          text: clean,
          startCursor: cursor,
          endCursor: boundary,
        });
        currentSegmentCount++;
      }
      cursor = boundary;
      continue;
    }

    // No natural boundary found.
    const waitBudgetMs = first ? 400 : 800;
    const elapsed = nowMs - lastCommittedAtMs;

    if (elapsed >= waitBudgetMs) {
      // Try emergency release at a safe position up to maximum chars.
      const limit = Math.min(text.length, cursor + maximum);
      const releasePos = findEmergencyReleasePosition(
        text,
        cursor,
        limit,
        ranges.noCut,
      );
      if (releasePos !== null && releasePos > cursor) {
        const raw = text.slice(cursor, releasePos);
        const clean = stripUnsafeContent(raw, ranges.strip, cursor).trim();
        if (clean) {
          segments.push({
            text: clean,
            startCursor: cursor,
            endCursor: releasePos,
          });
          currentSegmentCount++;
        }
        cursor = releasePos;
        continue;
      }
    }

    if (complete) {
      const tail = text.slice(cursor);
      const clean = stripUnsafeContent(tail, ranges.strip, cursor).trim();
      if (clean) {
        segments.push({
          text: clean,
          startCursor: cursor,
          endCursor: text.length,
        });
        currentSegmentCount++;
      }
      cursor = text.length;
    } else {
      break;
    }
  }

  return { segments, consumedCharacters: cursor };
}
