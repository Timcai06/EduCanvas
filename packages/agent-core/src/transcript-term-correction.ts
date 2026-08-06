/**
 * 转录术语纠错层（V02-X）。
 *
 * ## 职责
 *
 * 纯函数地把「Provider 原始 transcript + 当前 Notebook 已授权的权威术语表」
 * 收敛为「原始文本不变 + corrected transcript + 有界 replacement audit」。
 * 只纠正高度确定的专业术语，不自由重写句子，不使用 LLM，不访问数据库、
 * 网络、环境变量或 Provider。相同输入必产生完全相同输出。
 *
 * ## 确定性规则（ruleVersion v1）
 *
 * 1. 候选只能来自调用方传入的 authorizedTerms，模块内无任何术语硬编码
 *    （禁止全局 Begging→Bagging 之类字符串替换伪装成识别成功）。
 * 2. 只处理完整单词 token（连续 ASCII 字母）；粘连 token（如
 *    `methodsbegging`）与子串一律保持原文，不做任意 substring replace。
 * 3. 大小写不敏感完全匹配视为已正确，不产生 replacement。
 * 4. 编辑距离（Levenshtein，大小写不敏感）≤ MAX_EDIT_DISTANCE 才进入候选；
 *    最小距离并列多个候选（同距）→ 保持原文（证据不足，fail-closed）。
 * 5. 唯一候选还必须通过双侧上下文确认：术语条目携带的 context 词必须同时
 *    命中该 token 的前邻与后邻单词 token（大小写不敏感），缺任一侧（句首/
 *    句尾）或任一侧未命中都不改——这是保护真实普通词 begging/bursting 不被
 *    误改的关键：单侧命中（如后邻 reduces）不足以证明是术语误识。术语未
 *    携带 context 时不启用编辑距离纠正。
 * 6. 原始 transcript 永远保留在输出中，correctedTranscript 只做上述受控
 *    整词替换；标点与未修改文本逐字节保留。
 * 7. 每条 replacement 都带 tokenIndex/字符范围、ruleVersion、confidenceClass
 *    与 reversible=true，可被 applyTranscriptReplacements 反转。
 *
 * ## 安全边界
 *
 * 输出不含 Prompt、Provider body、音频、路径、Key 或 stack；错误面只暴露
 * 稳定错误码。本文件不包含任何 I/O、随机或全局可变状态。
 */

import { z } from 'zod';

/** 纠错协议版本：所有请求与 replacement 都必须声明该版本。 */
export const transcriptTermCorrectionProtocolVersion =
  'educanvas.transcript-term-correction.v1' as const;

/**
 * 输入文本上限（字符）。单次终稿超过该长度视为异常输入，拒绝而非无界
 * 接收；与流式转录 MAX_STREAMING_TRANSCRIPTION_TEXT_LENGTH 同数量级，
 * 覆盖 K12 单句/短段落场景。
 */
export const MAX_TRANSCRIPT_LENGTH = 4_000 as const;

/** 术语表条目数量上限：防止调用方传入无界术语表；K12 单课程术语远小于此。 */
export const MAX_AUTHORIZED_TERMS = 64 as const;

/** 单个术语词长上限：权威术语是短词，超长视为异常输入。 */
export const MAX_TERM_LENGTH = 64 as const;

/** 每个术语的上下文确认词数量上限。 */
export const MAX_CONTEXT_WORDS_PER_TERM = 8 as const;

/** 单个上下文确认词长度上限。 */
export const MAX_CONTEXT_WORD_LENGTH = 32 as const;

/**
 * 编辑距离上限。bursting→boosting 距离 2 是 V02-W 冻结样例需要覆盖的
 * 最远情况；距离 1 的 begging→bagging 也在此阈值内，因此必须由上下文
 * 确认兜底（见文件头规则 5），阈值本身不单独构成纠正证据。
 */
export const MAX_EDIT_DISTANCE = 2 as const;

/** replacement 数组上限：token 数受文本上限约束，此值仅为显式冗余保险。 */
export const MAX_REPLACEMENTS = 256 as const;

/** 大小写策略：preserve-original 沿用原 token 形态，term-canonical 用术语规范形。 */
export const transcriptCasePolicies = [
  'preserve-original',
  'term-canonical',
] as const;

export const transcriptCasePolicySchema = z.enum(transcriptCasePolicies);
export type TranscriptCasePolicy = z.infer<typeof transcriptCasePolicySchema>;

/**
 * 未修改原因（封闭枚举，仅当 replacements 为空时输出）：
 * - EMPTY_TERM_TABLE：术语表为空，无候选来源；
 * - NO_CANDIDATE_MATCHED：无任何单词 token 与任何术语构成编辑距离候选
 *   （含全部已正确、术语不在词表两种情况）；
 * - MULTIPLE_CANDIDATES_SAME_DISTANCE：有候选但最小距离并列，证据不足；
 * - CONTEXT_NOT_CONFIRMED：唯一候选但上下文未确认或术语未携带 context。
 */
export const transcriptUnchangedReasons = [
  'EMPTY_TERM_TABLE',
  'NO_CANDIDATE_MATCHED',
  'MULTIPLE_CANDIDATES_SAME_DISTANCE',
  'CONTEXT_NOT_CONFIRMED',
] as const;

export const transcriptUnchangedReasonSchema = z.enum(
  transcriptUnchangedReasons,
);
export type TranscriptUnchangedReason = z.infer<
  typeof transcriptUnchangedReasonSchema
>;

/**
 * 稳定错误码；失败面只允许这些码，不携带 Provider 细节、内部状态或堆栈。
 * INVALID_REPLACEMENT_INDEX 仅由可逆函数在数据不一致时抛出。
 */
export const transcriptCorrectionErrorCodes = [
  'EMPTY_TRANSCRIPT',
  'TRANSCRIPT_TOO_LONG',
  'TOO_MANY_TERMS',
  'INVALID_TERM',
  'TERM_TOO_LONG',
  'TERM_DUPLICATE',
  'TOO_MANY_CONTEXT_WORDS',
  'INVALID_CONTEXT_WORD',
  'CONTEXT_WORD_TOO_LONG',
  'INVALID_RULE_VERSION',
  'INVALID_CASE_POLICY',
  'TOO_MANY_REPLACEMENTS',
  'INVALID_INPUT',
  'INVALID_REPLACEMENT_INDEX',
  'REPLACEMENT_TOKEN_MISMATCH',
] as const;

export const transcriptCorrectionErrorCodeSchema = z.enum(
  transcriptCorrectionErrorCodes,
);
export type TranscriptCorrectionErrorCode = z.infer<
  typeof transcriptCorrectionErrorCodeSchema
>;

const asciiWordPattern = /^[A-Za-z]+$/;

/**
 * 单个权威术语条目。term 必须是纯 ASCII 字母词；context 为可选的课程
 * 上下文确认词（如 Boosting 常搭配 reduces），编辑距离纠正必须命中其一
 * 才执行，二者都只允许调用方（当前 Notebook）传入。
 */
export const authorizedTermSchema = z
  .object({
    term: z
      .string()
      .min(1)
      .max(MAX_TERM_LENGTH)
      .regex(asciiWordPattern, '术语必须是纯 ASCII 字母词'),
    context: z
      .array(
        z
          .string()
          .min(1)
          .max(MAX_CONTEXT_WORD_LENGTH)
          .regex(asciiWordPattern, '上下文确认词必须是纯 ASCII 字母词'),
      )
      .max(MAX_CONTEXT_WORDS_PER_TERM)
      .optional(),
  })
  .strict();

export type AuthorizedTerm = z.infer<typeof authorizedTermSchema>;

/** 纠错输入：严格 schema，所有字符串/数组都有界，未知键拒绝。 */
export const transcriptTermCorrectionInputSchema = z
  .object({
    originalTranscript: z.string().min(1).max(MAX_TRANSCRIPT_LENGTH),
    authorizedTerms: z.array(authorizedTermSchema).max(MAX_AUTHORIZED_TERMS),
    ruleVersion: z.literal(transcriptTermCorrectionProtocolVersion),
    casePolicy: transcriptCasePolicySchema.default('preserve-original'),
  })
  .strict();

export type TranscriptTermCorrectionInput = z.input<
  typeof transcriptTermCorrectionInputSchema
>;

/** parse 后的输出类型：casePolicy 已由 default 填值（必填）。 */
type ParsedTranscriptTermCorrectionInput = z.output<
  typeof transcriptTermCorrectionInputSchema
>;

/** 单条 replacement 审计记录；reversible 恒为 true，可被可逆函数还原。 */
export const transcriptReplacementSchema = z
  .object({
    /** 原始 transcript 中的完整单词 token（纠正前原文）。 */
    originalToken: z
      .string()
      .min(1)
      .max(MAX_TERM_LENGTH + MAX_EDIT_DISTANCE),
    /** 纠正后的术语（已按 casePolicy 应用大小写）。 */
    correctedTerm: z.string().min(1).max(MAX_TERM_LENGTH),
    /** 该 token 在单词序列中的序号（0 起，不含标点/空白）。 */
    tokenIndex: z.number().int().nonnegative(),
    /** 该 token 在原始 transcript 中的字符范围 [charStart, charEnd)。 */
    charStart: z.number().int().nonnegative(),
    charEnd: z.number().int().nonnegative(),
    ruleVersion: z.literal(transcriptTermCorrectionProtocolVersion),
    confidenceClass: z.literal('high'),
    reversible: z.literal(true),
  })
  .strict();

export type TranscriptReplacement = z.infer<typeof transcriptReplacementSchema>;

/** 纠错输出：原始文本永远保留，correctedTranscript 是受控整词替换结果。 */
export const transcriptTermCorrectionResultSchema = z
  .object({
    originalTranscript: z.string(),
    correctedTranscript: z.string(),
    replacements: z.array(transcriptReplacementSchema).max(MAX_REPLACEMENTS),
    unchangedReason: transcriptUnchangedReasonSchema.nullable(),
    /** 单词 token 总数（不含标点/空白）。 */
    totalTokenCount: z.number().int().nonnegative(),
    /** 未修改的单词 token 数量。 */
    unchangedTokenCount: z.number().int().nonnegative(),
  })
  .strict();

export type TranscriptTermCorrectionResult = z.infer<
  typeof transcriptTermCorrectionResultSchema
>;

/** 分词片段：word 为完整 ASCII 字母 token，other 为标点/空白/数字等原样片段。 */
interface TokenSegment {
  kind: 'word' | 'other';
  text: string;
  charStart: number;
  charEnd: number;
  /** 仅 word 片段有效：单词序列序号。 */
  wordIndex: number | null;
}

/**
 * 确定性分词：连续 ASCII 字母为一个 word token，其余（标点、空白、数字、
 * 其它字符）作为 other 片段原样保留。粘连 token（methodsbegging）是一个
 * word token，按 fail-closed 原则永远不被拆分纠正。
 */
function tokenize(text: string): TokenSegment[] {
  const segments: TokenSegment[] = [];
  const pattern = /[A-Za-z]+|[^A-Za-z]+/g;
  let wordIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const first = raw.charCodeAt(0);
    const isWord =
      (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
    segments.push({
      kind: isWord ? 'word' : 'other',
      text: raw,
      charStart: match.index,
      charEnd: match.index + raw.length,
      wordIndex: isWord ? wordIndex++ : null,
    });
  }
  return segments;
}

/** Levenshtein 距离（字符级，调用方保证双方已小写化且长度差已剪枝）。 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let previous: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let row = 1; row <= m; row += 1) {
    const current: number[] = [row];
    for (let column = 1; column <= n; column += 1) {
      const substitution =
        previous[column - 1]! +
        (a.charCodeAt(row - 1) === b.charCodeAt(column - 1) ? 0 : 1);
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[n]!;
}

/** 把术语投影到原 token 的大小写形态；混合大小写保留术语规范形。 */
function applyCase(
  term: string,
  originalToken: string,
  policy: TranscriptCasePolicy,
): string {
  if (policy === 'term-canonical') return term;
  if (originalToken === originalToken.toUpperCase()) return term.toUpperCase();
  const head = originalToken[0]!;
  const tail = originalToken.slice(1);
  if (head === head.toUpperCase() && tail === tail.toLowerCase()) {
    return term[0]!.toUpperCase() + term.slice(1).toLowerCase();
  }
  if (originalToken === originalToken.toLowerCase()) return term.toLowerCase();
  return term;
}

/** 显式稳定错误码校验，先于 schema 兜底执行，保证失败面只暴露稳定码。 */
function validateInputOrThrow(input: {
  originalTranscript: string;
  authorizedTerms: readonly AuthorizedTerm[];
  ruleVersion: string;
  casePolicy?: string;
}): void {
  if (input.ruleVersion !== transcriptTermCorrectionProtocolVersion) {
    throw new TranscriptTermCorrectionError('INVALID_RULE_VERSION');
  }
  if (
    input.casePolicy !== undefined &&
    !transcriptCasePolicies.includes(input.casePolicy as TranscriptCasePolicy)
  ) {
    throw new TranscriptTermCorrectionError('INVALID_CASE_POLICY');
  }
  if (input.originalTranscript.length === 0) {
    throw new TranscriptTermCorrectionError('EMPTY_TRANSCRIPT');
  }
  if (input.originalTranscript.length > MAX_TRANSCRIPT_LENGTH) {
    throw new TranscriptTermCorrectionError('TRANSCRIPT_TOO_LONG');
  }
  if (input.authorizedTerms.length > MAX_AUTHORIZED_TERMS) {
    throw new TranscriptTermCorrectionError('TOO_MANY_TERMS');
  }
  const seen = new Set<string>();
  for (const term of input.authorizedTerms) {
    if (term.term.length === 0 || !asciiWordPattern.test(term.term)) {
      throw new TranscriptTermCorrectionError('INVALID_TERM');
    }
    if (term.term.length > MAX_TERM_LENGTH) {
      throw new TranscriptTermCorrectionError('TERM_TOO_LONG');
    }
    // 大小写不敏感重复会破坏编辑距离候选的唯一性判定，直接拒绝。
    const key = term.term.toLowerCase();
    if (seen.has(key)) {
      throw new TranscriptTermCorrectionError('TERM_DUPLICATE');
    }
    seen.add(key);
    const context = term.context ?? [];
    if (context.length > MAX_CONTEXT_WORDS_PER_TERM) {
      throw new TranscriptTermCorrectionError('TOO_MANY_CONTEXT_WORDS');
    }
    for (const word of context) {
      if (word.length === 0 || !asciiWordPattern.test(word)) {
        throw new TranscriptTermCorrectionError('INVALID_CONTEXT_WORD');
      }
      if (word.length > MAX_CONTEXT_WORD_LENGTH) {
        throw new TranscriptTermCorrectionError('CONTEXT_WORD_TOO_LONG');
      }
    }
  }
}

interface EditCandidate {
  term: AuthorizedTerm;
  distance: number;
}

/**
 * 核心纠错纯函数。返回结果包含原始与纠正两版文本及 replacement audit；
 * 任何歧义（同距候选、上下文未确认、粘连 token）都保持原文（fail-closed）。
 */
export function correctTranscript(
  input: TranscriptTermCorrectionInput,
): TranscriptTermCorrectionResult {
  let parsed: ParsedTranscriptTermCorrectionInput;
  try {
    validateInputOrThrow(input);
    // schema 兜底：严格性与类型校验；任何未覆盖的运行时类型错误统一转稳定码。
    parsed = transcriptTermCorrectionInputSchema.parse(input);
  } catch (error) {
    // 显式校验已抛的稳定码保持原样，其余（TypeError/ZodError）归一为 INVALID_INPUT。
    if (error instanceof TranscriptTermCorrectionError) throw error;
    throw new TranscriptTermCorrectionError('INVALID_INPUT');
  }
  const { originalTranscript, authorizedTerms } = parsed;
  const casePolicy = parsed.casePolicy;

  const segments = tokenize(originalTranscript);
  const words = segments.filter(
    (segment): segment is TokenSegment & { wordIndex: number } =>
      segment.kind === 'word' && segment.wordIndex !== null,
  );

  const replacements: TranscriptReplacement[] = [];
  let sawMultipleCandidates = false;
  let sawContextRejected = false;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const lower = word.text.toLowerCase();

    // 大小写不敏感完全匹配视为已正确，不产生 replacement（大小写差异
    // 不是术语错误，保留 Provider 原文形态）。
    if (authorizedTerms.some((term) => term.term.toLowerCase() === lower)) {
      continue;
    }

    const candidates: EditCandidate[] = [];
    for (const term of authorizedTerms) {
      const termLower = term.term.toLowerCase();
      // 长度差剪枝：编辑距离不可能小于长度差，超过阈值直接跳过。
      if (Math.abs(termLower.length - lower.length) > MAX_EDIT_DISTANCE) {
        continue;
      }
      const distance = levenshteinDistance(lower, termLower);
      if (distance > 0 && distance <= MAX_EDIT_DISTANCE) {
        candidates.push({ term, distance });
      }
    }
    if (candidates.length === 0) continue;

    const minDistance = Math.min(...candidates.map((c) => c.distance));
    const best = candidates.filter((c) => c.distance === minDistance);
    if (best.length !== 1) {
      // 多个候选同距：证据不足，保持原文（原则 5）。
      sawMultipleCandidates = true;
      continue;
    }
    const candidate = best[0]!;
    const context = candidate.term.context ?? [];
    if (context.length === 0) {
      // 术语未携带上下文：编辑距离纠正无确认证据，fail-closed。
      sawContextRejected = true;
      continue;
    }
    const prevWord = index > 0 ? words[index - 1]!.text : null;
    const nextWord = index < words.length - 1 ? words[index + 1]!.text : null;
    // 双侧确认：前邻与后邻都必须命中 context 词。缺任一侧（句首/句尾）
    // 或任一侧未命中都保持原文——单侧命中（如后邻 reduces）不足以证明
    // 是术语误识，真实句 "Begging reduces suffering." 因此不会被误改。
    if (prevWord === null || nextWord === null) {
      sawContextRejected = true;
      continue;
    }
    const hitBefore = context.some(
      (contextWord) => prevWord.toLowerCase() === contextWord.toLowerCase(),
    );
    const hitAfter = context.some(
      (contextWord) => nextWord.toLowerCase() === contextWord.toLowerCase(),
    );
    if (!hitBefore || !hitAfter) {
      sawContextRejected = true;
      continue;
    }

    replacements.push({
      originalToken: word.text,
      correctedTerm: applyCase(candidate.term.term, word.text, casePolicy),
      tokenIndex: word.wordIndex,
      charStart: word.charStart,
      charEnd: word.charEnd,
      ruleVersion: transcriptTermCorrectionProtocolVersion,
      confidenceClass: 'high',
      reversible: true,
    });
  }

  // 有界声明必须被强制：病态输入（如 4000 个单字母词 + 单字母术语）可能
  // 产生超出 MAX_REPLACEMENTS 的替换，此时拒绝整个纠正而非部分替换。
  if (replacements.length > MAX_REPLACEMENTS) {
    throw new TranscriptTermCorrectionError('TOO_MANY_REPLACEMENTS');
  }

  const correctedTranscript = rebuild(segments, replacements);
  let unchangedReason: TranscriptUnchangedReason | null = null;
  if (replacements.length === 0) {
    if (authorizedTerms.length === 0) {
      unchangedReason = 'EMPTY_TERM_TABLE';
    } else if (sawMultipleCandidates) {
      unchangedReason = 'MULTIPLE_CANDIDATES_SAME_DISTANCE';
    } else if (sawContextRejected) {
      unchangedReason = 'CONTEXT_NOT_CONFIRMED';
    } else {
      unchangedReason = 'NO_CANDIDATE_MATCHED';
    }
  }

  return {
    originalTranscript,
    correctedTranscript,
    replacements,
    unchangedReason,
    totalTokenCount: words.length,
    unchangedTokenCount: words.length - replacements.length,
  };
}

/** 按 charStart 把命中片段替换为 correctedTerm，其余片段逐字节保留。 */
function rebuild(
  segments: readonly TokenSegment[],
  replacements: readonly TranscriptReplacement[],
): string {
  const replacementByStart = new Map<number, TranscriptReplacement>();
  for (const replacement of replacements) {
    replacementByStart.set(replacement.charStart, replacement);
  }
  let out = '';
  for (const segment of segments) {
    const replacement = replacementByStart.get(segment.charStart);
    out += replacement ? replacement.correctedTerm : segment.text;
  }
  return out;
}

/**
 * 可逆函数：把 correctedTranscript 中 tokenIndex 命中的词还原为
 * originalToken。纠正只改词文本、不改变词边界与顺序，因此 tokenIndex
 * 在纠正前后一致。数据不一致（tokenIndex 越界或重复）抛
 * INVALID_REPLACEMENT_INDEX。
 *
 * 审计校验：对每个 replacement 位置同时验证「词内容仍等于 correctedTerm」
 * 与「字符偏移仍等于 原始 charStart + 此前替换长度差累计」。内容校验捕获
 * 词被替换/删除/前置插入造成的错位，偏移校验捕获后置插入/删除造成的
 * 位置漂移——两者任一不符都抛 REPLACEMENT_TOKEN_MISMATCH，拒绝把被篡改
 * 的 correctedTranscript 声称“成功恢复”。末尾追加词不改任何 replacement
 * 位置的内容与偏移，超出本函数（无 original 参照）的判定范围。
 */
export function applyTranscriptReplacements(
  correctedTranscript: string,
  replacements: readonly TranscriptReplacement[],
): string {
  if (replacements.length === 0) return correctedTranscript;
  const byIndex = new Map<number, TranscriptReplacement>();
  for (const replacement of replacements) {
    if (byIndex.has(replacement.tokenIndex)) {
      throw new TranscriptTermCorrectionError('INVALID_REPLACEMENT_INDEX');
    }
    byIndex.set(replacement.tokenIndex, replacement);
  }
  const segments = tokenize(correctedTranscript);
  const wordCount = segments.filter(
    (segment) => segment.kind === 'word',
  ).length;
  for (const replacement of replacements) {
    if (replacement.tokenIndex >= wordCount) {
      throw new TranscriptTermCorrectionError('INVALID_REPLACEMENT_INDEX');
    }
  }
  // 预期偏移：corrected 中该 token 的字符偏移 = 原始 charStart 加上此前
  // 所有替换的长度差累计（纠正不改变其它文本的字节内容）。
  const expectedOffset = new Map<number, number>();
  let delta = 0;
  for (const replacement of [...replacements].sort(
    (a, b) => a.tokenIndex - b.tokenIndex,
  )) {
    expectedOffset.set(replacement.tokenIndex, replacement.charStart + delta);
    delta +=
      replacement.correctedTerm.length - replacement.originalToken.length;
  }
  let out = '';
  for (const segment of segments) {
    if (segment.kind === 'word' && segment.wordIndex !== null) {
      const replacement = byIndex.get(segment.wordIndex);
      if (replacement) {
        if (
          segment.text !== replacement.correctedTerm ||
          segment.charStart !== expectedOffset.get(replacement.tokenIndex)
        ) {
          throw new TranscriptTermCorrectionError('REPLACEMENT_TOKEN_MISMATCH');
        }
        out += replacement.originalToken;
      } else {
        out += segment.text;
      }
    } else {
      out += segment.text;
    }
  }
  return out;
}

/** 稳定错误：只暴露 code，message 与 code 一致，不携带内部状态。 */
export class TranscriptTermCorrectionError extends Error {
  override readonly name = 'TranscriptTermCorrectionError';
  readonly code: TranscriptCorrectionErrorCode;

  constructor(code: TranscriptCorrectionErrorCode) {
    super(code);
    this.code = code;
  }
}
