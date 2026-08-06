import { describe, expect, it } from 'vitest';
import {
  MAX_AUTHORIZED_TERMS,
  MAX_EDIT_DISTANCE,
  MAX_TRANSCRIPT_LENGTH,
  TranscriptTermCorrectionError,
  applyTranscriptReplacements,
  correctTranscript,
  transcriptTermCorrectionInputSchema,
  transcriptTermCorrectionProtocolVersion,
  transcriptTermCorrectionResultSchema,
  transcriptUnchangedReasonSchema,
  type AuthorizedTerm,
  type TranscriptTermCorrectionInput,
} from './transcript-term-correction';

/** V02-W 冻结样例：三次云端终稿完全相同的原始 transcript（evidence/v02-w-summary.json）。 */
const FROZEN_TRANSCRIPT =
  'Bagging and boosting are two classic assemble methodsbegging reduces variance while bursting reduces buyers.';

/** 冻结样例当前 Notebook 术语表：术语 + 课程上下文确认词（双侧：前/后邻都要命中）。 */
const FROZEN_TERMS: AuthorizedTerm[] = [
  { term: 'Bagging', context: ['reduces', 'variance'] },
  { term: 'Boosting', context: ['while', 'reduces'] },
];

function input(
  overrides: Partial<TranscriptTermCorrectionInput> = {},
): TranscriptTermCorrectionInput {
  return {
    originalTranscript: FROZEN_TRANSCRIPT,
    authorizedTerms: FROZEN_TERMS,
    ruleVersion: transcriptTermCorrectionProtocolVersion,
    ...overrides,
  };
}

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof TranscriptTermCorrectionError) return error.code;
    throw error;
  }
  throw new Error('expected TranscriptTermCorrectionError');
}

describe('V02-X 正例：冻结样例', () => {
  it('冻结样例只纠正 bursting→boosting，其余保持原文', () => {
    const result = correctTranscript(input());
    expect(result.correctedTranscript).toBe(
      'Bagging and boosting are two classic assemble methodsbegging reduces variance while boosting reduces buyers.',
    );
    expect(result.replacements).toHaveLength(1);
    expect(result.replacements[0]).toEqual({
      originalToken: 'bursting',
      correctedTerm: 'boosting',
      tokenIndex: 11,
      charStart: 84,
      charEnd: 92,
      ruleVersion: transcriptTermCorrectionProtocolVersion,
      confidenceClass: 'high',
      reversible: true,
    });
    // 粘连 token methodsbegging 按原则 2 保持原文（fail-closed，负责人已确认）。
    expect(result.correctedTranscript).toContain('methodsbegging');
    // 普通词错误 assemble/buyers 不在术语表，不得自由重写句子。
    expect(result.correctedTranscript).toContain('assemble');
    expect(result.correctedTranscript).toContain('buyers');
  });

  it('相同输入重复执行三次结果完全一致（确定性）', () => {
    const first = correctTranscript(input());
    const second = correctTranscript(input());
    const third = correctTranscript(input());
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('corrected 与 original 明确区分且原始文本被保留', () => {
    const result = correctTranscript(input());
    expect(result.originalTranscript).toBe(FROZEN_TRANSCRIPT);
    expect(result.correctedTranscript).not.toBe(FROZEN_TRANSCRIPT);
    expect(result.originalTranscript).not.toBe(result.correctedTranscript);
    expect(result.totalTokenCount).toBe(14);
    expect(result.unchangedTokenCount).toBe(13);
  });
});

describe('V02-X 负例：普通词与歧义 fail-closed', () => {
  it('术语不在词表时不修改', () => {
    const result = correctTranscript(
      input({ authorizedTerms: [{ term: 'AdaBoost' }] }),
    );
    expect(result.correctedTranscript).toBe(FROZEN_TRANSCRIPT);
    expect(result.replacements).toHaveLength(0);
    expect(result.unchangedReason).toBe('NO_CANDIDATE_MATCHED');
  });

  it('空词表时不修改并报告 EMPTY_TERM_TABLE', () => {
    const result = correctTranscript(input({ authorizedTerms: [] }));
    expect(result.correctedTranscript).toBe(FROZEN_TRANSCRIPT);
    expect(result.replacements).toHaveLength(0);
    expect(result.unchangedReason).toBe('EMPTY_TERM_TABLE');
  });

  it('begging 作为真实普通词（无上下文确认）时不修改', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'She was begging for help.',
        authorizedTerms: [
          { term: 'Bagging', context: ['reduces', 'variance'] },
        ],
      }),
    );
    expect(result.correctedTranscript).toBe('She was begging for help.');
    expect(result.replacements).toHaveLength(0);
    expect(result.unchangedReason).toBe('CONTEXT_NOT_CONFIRMED');
  });

  it('begging 即使后邻命中 context 也不修改（双侧确认，缺前邻）', () => {
    // REVISE 回归：真实句 Begging reduces suffering. 不得被误改为 Bagging。
    const result = correctTranscript(
      input({
        originalTranscript: 'Begging reduces suffering.',
        authorizedTerms: [
          { term: 'Bagging', context: ['reduces', 'variance'] },
        ],
      }),
    );
    expect(result.correctedTranscript).toBe('Begging reduces suffering.');
    expect(result.replacements).toHaveLength(0);
    expect(result.unchangedReason).toBe('CONTEXT_NOT_CONFIRMED');
  });

  it('bursting 作为真实普通词（无上下文确认）时不修改', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'The balloon is bursting.',
        authorizedTerms: [{ term: 'Boosting', context: ['reduces', 'bias'] }],
      }),
    );
    expect(result.correctedTranscript).toBe('The balloon is bursting.');
    expect(result.replacements).toHaveLength(0);
    expect(result.unchangedReason).toBe('CONTEXT_NOT_CONFIRMED');
  });

  it('编辑距离候选但术语未携带 context 时不修改（fail-closed）', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'bursting reduces bias',
        authorizedTerms: [{ term: 'Boosting' }],
      }),
    );
    expect(result.correctedTranscript).toBe('bursting reduces bias');
    expect(result.replacements).toHaveLength(0);
    expect(result.unchangedReason).toBe('CONTEXT_NOT_CONFIRMED');
  });

  it('多个候选同距时不修改（证据不足）', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'bagging reduces variance',
        authorizedTerms: [
          { term: 'Baggung', context: ['reduces'] },
          { term: 'Baggong', context: ['reduces'] },
        ],
      }),
    );
    expect(result.correctedTranscript).toBe('bagging reduces variance');
    expect(result.replacements).toHaveLength(0);
    expect(result.unchangedReason).toBe('MULTIPLE_CANDIDATES_SAME_DISTANCE');
  });

  it('大小写不敏感完全匹配视为已正确，不产生 replacement', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'bagging reduces variance',
        authorizedTerms: [{ term: 'Bagging', context: ['reduces'] }],
      }),
    );
    expect(result.correctedTranscript).toBe('bagging reduces variance');
    expect(result.replacements).toHaveLength(0);
    expect(result.unchangedReason).toBe('NO_CANDIDATE_MATCHED');
  });
});

describe('V02-X 大小写策略', () => {
  it('preserve-original（默认）：全大写 token 投影为全大写术语', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'while BURSTING reduces bias',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
      }),
    );
    expect(result.correctedTranscript).toBe('while BOOSTING reduces bias');
    expect(result.replacements[0]!.correctedTerm).toBe('BOOSTING');
  });

  it('preserve-original：首字母大写 token 投影为首字母大写术语', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'while Bursting reduces bias',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
      }),
    );
    expect(result.correctedTranscript).toBe('while Boosting reduces bias');
    expect(result.replacements[0]!.correctedTerm).toBe('Boosting');
  });

  it('term-canonical：纠正术语使用术语表规范大小写', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'while bursting reduces bias',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
        casePolicy: 'term-canonical',
      }),
    );
    expect(result.correctedTranscript).toBe('while Boosting reduces bias');
    expect(result.replacements[0]!.correctedTerm).toBe('Boosting');
  });
});

describe('V02-X 标点与位置边界', () => {
  it('标点边界：纠正完整 token 且标点逐字节保留', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'while (bursting, reduces bias).',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
      }),
    );
    expect(result.correctedTranscript).toBe('while (boosting, reduces bias).');
    expect(result.replacements[0]).toMatchObject({
      originalToken: 'bursting',
      correctedTerm: 'boosting',
      charStart: 7,
      charEnd: 15,
    });
  });

  it('句首 token 保持原文（缺前邻，双侧确认失败）', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'bursting reduces variance',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
      }),
    );
    expect(result.correctedTranscript).toBe('bursting reduces variance');
    expect(result.replacements).toHaveLength(0);
    expect(result.unchangedReason).toBe('CONTEXT_NOT_CONFIRMED');
  });

  it('句尾 token 保持原文（缺后邻，双侧确认失败）', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'variance reduces bursting',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
      }),
    );
    expect(result.correctedTranscript).toBe('variance reduces bursting');
    expect(result.replacements).toHaveLength(0);
    expect(result.unchangedReason).toBe('CONTEXT_NOT_CONFIRMED');
  });

  it('句中双侧上下文命中的 token 可纠正', () => {
    const result = correctTranscript(
      input({
        originalTranscript: 'while bursting reduces bias',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
      }),
    );
    expect(result.correctedTranscript).toBe('while boosting reduces bias');
    expect(result.replacements[0]!.tokenIndex).toBe(1);
  });

  it('重复术语产生多条可区分 replacement', () => {
    const result = correctTranscript(
      input({
        originalTranscript:
          'while bursting reduces bias while bursting reduces bias',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
      }),
    );
    expect(result.replacements).toHaveLength(2);
    expect(result.replacements[0]!.tokenIndex).toBe(1);
    expect(result.replacements[1]!.tokenIndex).toBe(5);
    expect(result.correctedTranscript).toBe(
      'while boosting reduces bias while boosting reduces bias',
    );
  });

  it('非 ASCII 与数字片段保留且不参与纠正', () => {
    const result = correctTranscript(
      input({
        originalTranscript: '第2课 while bursting reduces',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
      }),
    );
    expect(result.correctedTranscript).toBe('第2课 while boosting reduces');
    expect(result.totalTokenCount).toBe(3);
  });
});

describe('V02-X 拒绝路径（稳定错误码）', () => {
  it('空 transcript 拒绝', () => {
    expect(
      errorCodeOf(() => correctTranscript(input({ originalTranscript: '' }))),
    ).toBe('EMPTY_TRANSCRIPT');
  });

  it('超长文本拒绝（含边界接受）', () => {
    const long = 'a'.repeat(MAX_TRANSCRIPT_LENGTH + 1);
    expect(
      errorCodeOf(() => correctTranscript(input({ originalTranscript: long }))),
    ).toBe('TRANSCRIPT_TOO_LONG');
    // 边界值 4000 字符通过校验且不抛错（无候选，保持原文）。
    const boundary = correctTranscript(
      input({
        originalTranscript: 'a'.repeat(MAX_TRANSCRIPT_LENGTH),
        authorizedTerms: [{ term: 'Bagging' }],
      }),
    );
    expect(boundary.replacements).toHaveLength(0);
  });

  it('术语数量超限拒绝', () => {
    const terms = Array.from({ length: MAX_AUTHORIZED_TERMS + 1 }, (_, i) => ({
      term: i < 64 ? 'a'.repeat(i + 1) : 'b',
    }));
    expect(
      errorCodeOf(() => correctTranscript(input({ authorizedTerms: terms }))),
    ).toBe('TOO_MANY_TERMS');
  });

  it('非法规则版本拒绝', () => {
    expect(
      errorCodeOf(() =>
        correctTranscript(
          input({
            ruleVersion: 'v0',
          } as unknown as TranscriptTermCorrectionInput),
        ),
      ),
    ).toBe('INVALID_RULE_VERSION');
  });

  it('非法大小写策略拒绝', () => {
    expect(
      errorCodeOf(() =>
        correctTranscript(
          input({
            casePolicy: 'shout',
          } as unknown as TranscriptTermCorrectionInput),
        ),
      ),
    ).toBe('INVALID_CASE_POLICY');
  });

  it('非法术语字符拒绝', () => {
    expect(
      errorCodeOf(() =>
        correctTranscript(input({ authorizedTerms: [{ term: 'Bagging!' }] })),
      ),
    ).toBe('INVALID_TERM');
  });

  it('大小写不敏感重复术语拒绝', () => {
    expect(
      errorCodeOf(() =>
        correctTranscript(
          input({
            authorizedTerms: [{ term: 'Bagging' }, { term: 'bagging' }],
          }),
        ),
      ),
    ).toBe('TERM_DUPLICATE');
  });

  it('上下文确认词超限/非法拒绝', () => {
    expect(
      errorCodeOf(() =>
        correctTranscript(
          input({
            authorizedTerms: [
              {
                term: 'Boosting',
                context: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
              },
            ],
          }),
        ),
      ),
    ).toBe('TOO_MANY_CONTEXT_WORDS');
    expect(
      errorCodeOf(() =>
        correctTranscript(
          input({
            authorizedTerms: [{ term: 'Boosting', context: ['reduces!'] }],
          }),
        ),
      ),
    ).toBe('INVALID_CONTEXT_WORD');
  });

  it('替换数超限拒绝整个纠正（有界声明强制）', () => {
    expect(
      errorCodeOf(() =>
        correctTranscript(
          input({
            originalTranscript: Array.from({ length: 300 }, () => 'a').join(
              ' ',
            ),
            authorizedTerms: [{ term: 'b', context: ['a'] }],
          }),
        ),
      ),
    ).toBe('TOO_MANY_REPLACEMENTS');
  });

  it('类型错误输入统一转稳定错误码', () => {
    expect(
      errorCodeOf(() =>
        correctTranscript(
          input({
            originalTranscript: 42,
          } as unknown as TranscriptTermCorrectionInput),
        ),
      ),
    ).toBe('INVALID_INPUT');
    // null 输入同样走稳定码路径，不泄漏原生 TypeError。
    expect(
      errorCodeOf(() =>
        correctTranscript(null as unknown as TranscriptTermCorrectionInput),
      ),
    ).toBe('INVALID_INPUT');
  });
});

describe('V02-X replacement audit 可逆性与严格 schema', () => {
  it('可逆：applyTranscriptReplacements 恢复原始文本', () => {
    const cases = [
      FROZEN_TRANSCRIPT,
      'while (bursting, reduces bias).',
      'while bursting reduces bias while bursting reduces bias',
    ];
    for (const transcript of cases) {
      const result = correctTranscript(
        input({
          originalTranscript: transcript,
          authorizedTerms: FROZEN_TERMS,
        }),
      );
      const restored = applyTranscriptReplacements(
        result.correctedTranscript,
        result.replacements,
      );
      expect(restored).toBe(transcript);
    }
  });

  it('可逆：同术语多处出现也能按 tokenIndex 精确还原', () => {
    const result = correctTranscript(
      input({
        originalTranscript:
          'while bursting reduces bias while bursting reduces bias',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
      }),
    );
    expect(result.replacements).toHaveLength(2);
    expect(
      applyTranscriptReplacements(
        result.correctedTranscript,
        result.replacements,
      ),
    ).toBe('while bursting reduces bias while bursting reduces bias');
  });

  it('可逆函数对损坏数据抛稳定错误码', () => {
    const result = correctTranscript(input());
    expect(
      errorCodeOf(() =>
        applyTranscriptReplacements(result.correctedTranscript, [
          { ...result.replacements[0]!, tokenIndex: 999 },
        ]),
      ),
    ).toBe('INVALID_REPLACEMENT_INDEX');
  });

  it('可逆函数拒绝被篡改的 correctedTranscript（REVISE 回归）', () => {
    const result = correctTranscript(input());
    const { charStart, correctedTerm } = result.replacements[0]!;
    const corrected = result.correctedTranscript;
    // 场景 A：替换 replacement 记录位置的词。
    const replaced =
      corrected.slice(0, charStart) +
      'tampered' +
      corrected.slice(charStart + correctedTerm.length);
    expect(
      errorCodeOf(() =>
        applyTranscriptReplacements(replaced, result.replacements),
      ),
    ).toBe('REPLACEMENT_TOKEN_MISMATCH');
    // 场景 B：在 replacement 位置前插入一个词（tokenIndex 错位）。
    const insertedBefore =
      corrected.slice(0, charStart) + 'evil ' + corrected.slice(charStart);
    expect(
      errorCodeOf(() =>
        applyTranscriptReplacements(insertedBefore, result.replacements),
      ),
    ).toBe('REPLACEMENT_TOKEN_MISMATCH');
    // 场景 C：在两个 replacement 之间插入一个词（wordIndex 漂移，内容校验触发）。
    const two = correctTranscript(
      input({
        originalTranscript:
          'while bursting reduces bias while bursting reduces bias',
        authorizedTerms: [{ term: 'Boosting', context: ['while', 'reduces'] }],
      }),
    );
    expect(two.replacements).toHaveLength(2);
    const insertedBetween = two.correctedTranscript.replace(
      'boosting reduces bias while',
      'boosting evil reduces bias while',
    );
    expect(
      errorCodeOf(() =>
        applyTranscriptReplacements(insertedBetween, two.replacements),
      ),
    ).toBe('REPLACEMENT_TOKEN_MISMATCH');
    // 场景 D：插入空格（other 片段），词与 wordIndex 均不变、仅后续字符
    // 偏移漂移——唯一命中偏移校验分支的篡改路径。
    const extraSpace = two.correctedTranscript.replace(
      'boosting reduces',
      'boosting  reduces',
    );
    expect(
      errorCodeOf(() =>
        applyTranscriptReplacements(extraSpace, two.replacements),
      ),
    ).toBe('REPLACEMENT_TOKEN_MISMATCH');
  });

  it('可逆：纠正前后词长不同也能按预期偏移精确还原', () => {
    // baggingg(8)→bagging(7) 长度差 -1，第二条 replacement 的偏移会累计漂移。
    const result = correctTranscript(
      input({
        originalTranscript:
          'while baggingg reduces variance while baggingg reduces variance',
        authorizedTerms: [{ term: 'Bagging', context: ['while', 'reduces'] }],
      }),
    );
    expect(result.replacements).toHaveLength(2);
    expect(result.correctedTranscript).toBe(
      'while bagging reduces variance while bagging reduces variance',
    );
    expect(
      applyTranscriptReplacements(
        result.correctedTranscript,
        result.replacements,
      ),
    ).toBe('while baggingg reduces variance while baggingg reduces variance');
  });

  it('输出通过严格结果 schema 且所有数组有界', () => {
    const result = correctTranscript(input());
    const parsed = transcriptTermCorrectionResultSchema.parse(result);
    expect(parsed).toEqual(result);
    expect(result.replacements.length).toBeLessThanOrEqual(256);
    // 封闭枚举可被 schema 校验。
    expect(transcriptUnchangedReasonSchema.parse('CONTEXT_NOT_CONFIRMED')).toBe(
      'CONTEXT_NOT_CONFIRMED',
    );
  });

  it('输入 schema 拒绝未知键与越界值', () => {
    expect(() =>
      transcriptTermCorrectionInputSchema.parse({
        originalTranscript: 'x',
        authorizedTerms: [],
        ruleVersion: transcriptTermCorrectionProtocolVersion,
        extra: true,
      }),
    ).toThrow();
    expect(() =>
      transcriptTermCorrectionInputSchema.parse({
        originalTranscript: 'x',
        authorizedTerms: [],
        ruleVersion: 'bogus',
      }),
    ).toThrow();
  });

  it('输出不含绝对路径、Key、Provider body 或 stack', () => {
    const result = correctTranscript(input());
    const raw = JSON.stringify(result);
    expect(raw).not.toMatch(/\/Users\/|\/home\/|\/tmp\/|[A-Za-z]:\\/);
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]{8,}|Bearer\s+\S+/i);
    expect(raw).not.toMatch(/response\s*body/i);
    expect(raw).not.toMatch(/\n\s*at\s+\S+/);
    expect(raw).not.toContain('.env');
  });

  it('冻结样例纠错距离确在阈值内（规则自证）', () => {
    // bursting→boosting 距离 2 等于 MAX_EDIT_DISTANCE；若阈值被改动，
    // 冻结样例与负例的边界都会失效，此处固化该约束。
    expect(MAX_EDIT_DISTANCE).toBe(2);
    expect(MAX_AUTHORIZED_TERMS).toBe(64);
  });
});
