import type { SubtitleDurationClock } from './subtitle-clock/recovery';

const DEFAULT_MAX_SPEECH_CHARACTERS = 1_600;
const LONG_CUE_CHARACTERS = 34;

export interface LiveSubtitleCue {
  readonly id: string;
  readonly text: string;
  readonly startOffsetSeconds: number;
  readonly estimatedDurationSeconds: number;
}

export interface LiveSubtitleCueOptions {
  readonly durationClock?: SubtitleDurationClock | null;
}

/** 将聊天 Markdown 收敛成适合连续 TTS 的口语文本，不把代码、链接和公式语法读出来。 */
export function prepareLiveSpeechText(
  source: string,
  maxCharacters = DEFAULT_MAX_SPEECH_CHARACTERS,
): string {
  const spoken = source
    .replace(/```[\s\S]*?```/g, '。代码示例已经放在聊天记录里。')
    .replace(/\$\$[\s\S]*?\$\$/g, '。具体公式已经显示在聊天记录里。')
    .replace(/\\\[[\s\S]*?\\\]/g, '。具体公式已经显示在聊天记录里。')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[(\d+)\]/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '；')
    .replace(/^\s*\d+[.)、]\s+/gm, '；')
    .replace(/[*_~`>|]/g, '')
    .replace(/\\theta/g, '西塔')
    .replace(/\\pi/g, '派')
    .replace(/\\times/g, '乘以')
    .replace(/\\(?:boxed|frac|left|right|cos|sin|cdots)/g, ' ')
    .replace(/[{}\\]/g, ' ')
    .replace(/\r?\n+/g, '。')
    .replace(/\s+/g, ' ')
    .replace(/。{2,}/g, '。')
    .replace(/；{2,}/g, '；')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .replace(/^[。；，,\s]+/, '')
    .trim();
  if ([...spoken].length <= maxCharacters) return spoken;
  const prefix = [...spoken].slice(0, maxCharacters).join('');
  const boundary = Math.max(
    prefix.lastIndexOf('。'),
    prefix.lastIndexOf('！'),
    prefix.lastIndexOf('？'),
    prefix.lastIndexOf('；'),
  );
  const naturalPrefix =
    boundary >= maxCharacters * 0.65 ? prefix.slice(0, boundary + 1) : prefix;
  return `${naturalPrefix}更多细节已经放在聊天记录里。`;
}

/** 字幕 cue 只负责显示节奏；TTS 始终接收完整文本，避免逐句合成造成音色和语气重置。 */
export function createLiveSubtitleCues(
  text: string,
  options: LiveSubtitleCueOptions = {},
): readonly LiveSubtitleCue[] {
  const scale = options.durationClock?.getScaleFactor() ?? 1;
  const phrases = splitIntoSubtitlePhrases(text);
  let offset = 0;
  return phrases.map((phrase, index) => {
    const duration = Number(
      Math.max(0.08, estimateSpeechDurationSeconds(phrase) * scale).toFixed(2),
    );
    const cue = {
      id: `speech-cue-${index}`,
      text: phrase,
      startOffsetSeconds: offset,
      estimatedDurationSeconds: duration,
    };
    offset += duration;
    return cue;
  });
}

function splitIntoSubtitlePhrases(text: string): readonly string[] {
  const sentences = text.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [text];
  return sentences.flatMap((sentence) => splitLongPhrase(sentence.trim()));
}

function splitLongPhrase(phrase: string): readonly string[] {
  if ([...phrase].length <= LONG_CUE_CHARACTERS) return phrase ? [phrase] : [];
  const clauses = phrase
    .split(/(?<=[，,：:])/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length > 1) {
    const groups: string[] = [];
    let current = '';
    for (const clause of clauses) {
      if (current && [...`${current}${clause}`].length > LONG_CUE_CHARACTERS) {
        groups.push(current);
        current = clause;
      } else {
        current += clause;
      }
    }
    if (current) groups.push(current);
    return groups.flatMap((group) => splitByCharacterLimit(group));
  }
  return splitByCharacterLimit(phrase);
}

function splitByCharacterLimit(text: string): readonly string[] {
  const characters = [...text];
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += LONG_CUE_CHARACTERS) {
    chunks.push(characters.slice(index, index + LONG_CUE_CHARACTERS).join(''));
  }
  return chunks;
}

function estimateSpeechDurationSeconds(text: string): number {
  const hanCharacters = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords =
    text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  const pauses = text.match(/[，,。！？!?；;：:]/g)?.length ?? 0;
  const seconds = hanCharacters * 0.17 + latinWords * 0.26 + pauses * 0.12;
  return Math.min(6, Math.max(0.8, Number(seconds.toFixed(2))));
}
