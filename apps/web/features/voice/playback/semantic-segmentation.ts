import {
  findSpeechSafetyRanges,
  isSpeechCutSafe,
  stripUnsafeSpeechContent,
  type SpeechUnsafeRange,
} from './semantic-segmentation-safety';

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

export interface SemanticSegment {
  readonly text: string;
  readonly startCursor: number;
  readonly endCursor: number;
}

export interface SemanticSegmentBatch {
  readonly segments: readonly SemanticSegment[];
  readonly consumedCharacters: number;
  /** Retry only while a real wait budget remains; null means wait for new text. */
  readonly retryAfterMs: number | null;
}

export interface SemanticSegmentInput {
  readonly text: string;
  readonly consumedCharacters: number;
  readonly segmentCount: number;
  readonly complete: boolean;
  readonly nowMs: number;
  /** Time at which the current uncommitted suffix first became pending. */
  readonly waitingSinceMs: number;
}

function isAbbreviationBefore(text: string, position: number): boolean {
  let wordStart = position - 1;
  while (wordStart >= 0 && /[a-zA-Z]/u.test(text[wordStart]!)) wordStart -= 1;
  const word = text.slice(wordStart + 1, position);
  if (ABBREVIATION_WORDS.has(word)) return true;
  // Initials such as “U.S.” must remain in the same spoken phrase.
  return word.length === 1 && /[A-Z]/u.test(word);
}

function isSentenceEnd(text: string, position: number): boolean {
  if (position < 0 || position >= text.length) return false;
  const character = text[position]!;
  if (!SENTENCE_END.test(character)) return false;
  if (character === '.' && isAbbreviationBefore(text, position)) return false;
  if (
    character === '.' &&
    position > 0 &&
    position + 1 < text.length &&
    /\d/u.test(text[position - 1]!) &&
    /\d/u.test(text[position + 1]!)
  ) {
    return false;
  }
  return true;
}

function isLexicalBoundary(text: string, position: number): boolean {
  if (position <= 0 || position >= text.length) return true;
  return !(
    /[a-zA-Z0-9]/u.test(text[position - 1]!) &&
    /[a-zA-Z0-9]/u.test(text[position]!)
  );
}

function findBestBoundary(
  text: string,
  start: number,
  minimum: number,
  maximum: number,
  noCut: readonly SpeechUnsafeRange[],
): number | null {
  const upper = Math.min(text.length, start + maximum);
  for (let index = start + minimum - 1; index < upper; index += 1) {
    if (isSentenceEnd(text, index) && isSpeechCutSafe(index + 1, noCut)) {
      return index + 1;
    }
  }
  for (let index = upper - 1; index >= start + minimum - 1; index -= 1) {
    if (
      (SOFT_BREAK.test(text[index]!) || /\s/u.test(text[index]!)) &&
      isSpeechCutSafe(index + 1, noCut)
    ) {
      return index + 1;
    }
  }
  for (const range of noCut) {
    if (range.end >= start + minimum && range.end <= upper) return range.end;
  }
  return null;
}

function findEmergencyReleasePosition(
  text: string,
  start: number,
  minimum: number,
  maximum: number,
  noCut: readonly SpeechUnsafeRange[],
): number | null {
  const lower = start + minimum;
  for (
    let position = Math.min(text.length, start + maximum);
    position >= lower;
    position -= 1
  ) {
    if (isSpeechCutSafe(position, noCut) && isLexicalBoundary(text, position)) {
      return position;
    }
  }
  return null;
}

function cleanSegmentText(
  text: string,
  start: number,
  end: number,
  strip: readonly SpeechUnsafeRange[],
): string {
  return stripUnsafeSpeechContent(text.slice(start, end), strip, start).trim();
}

/** Extract stable, speakable phrases while retaining offsets into displayed text. */
export function takeSemanticSpeechSegments(
  input: SemanticSegmentInput,
): SemanticSegmentBatch {
  const { text, complete, nowMs, waitingSinceMs } = input;
  if (input.consumedCharacters < 0 || input.consumedCharacters > text.length) {
    return { segments: [], consumedCharacters: 0, retryAfterMs: null };
  }

  const ranges = findSpeechSafetyRanges(text);
  const segments: SemanticSegment[] = [];
  let cursor = input.consumedCharacters;
  let segmentCount = input.segmentCount;
  let retryAfterMs: number | null = null;

  while (cursor < text.length) {
    const first = segmentCount === 0;
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
      const clean = cleanSegmentText(text, cursor, boundary, ranges.strip);
      // The threshold applies to speakable text, not stripped source syntax.
      if (!clean || clean.length >= minimum) {
        if (clean) {
          segments.push({
            text: clean,
            startCursor: cursor,
            endCursor: boundary,
          });
          segmentCount += 1;
        }
        cursor = boundary;
        continue;
      }
    }

    if (complete) {
      const clean = cleanSegmentText(text, cursor, text.length, ranges.strip);
      if (clean) {
        segments.push({
          text: clean,
          startCursor: cursor,
          endCursor: text.length,
        });
      }
      cursor = text.length;
      break;
    }

    const waitBudgetMs = first ? 400 : 800;
    const elapsed =
      segments.length > 0 ? 0 : Math.max(0, nowMs - waitingSinceMs);
    if (elapsed < waitBudgetMs) {
      retryAfterMs = waitBudgetMs - elapsed;
      break;
    }

    const releasePosition = findEmergencyReleasePosition(
      text,
      cursor,
      minimum,
      maximum,
      ranges.noCut,
    );
    if (releasePosition === null) break;
    const clean = cleanSegmentText(text, cursor, releasePosition, ranges.strip);
    if (clean.length < minimum) break;
    segments.push({
      text: clean,
      startCursor: cursor,
      endCursor: releasePosition,
    });
    segmentCount += 1;
    cursor = releasePosition;
  }

  return { segments, consumedCharacters: cursor, retryAfterMs };
}
