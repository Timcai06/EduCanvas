/**
 * K12 教学安全策略 — 确定性检测器，不依赖模型判断。
 *
 * ## 为什么不用模型做安全检测？
 *
 * 1. **延迟** — 模型调用 200ms+，正则检测 < 1ms
 * 2. **不确定性** — 同一输入两次可能不同结果，审计不可接受
 * 3. **绕过风险** — prompt injection 就是针对模型的，用模型检测模型不安全
 *
 * ## 两阶段检查
 *
 * - **input 阶段** — 学生消息进入前检查。包含输入格式校验（非字符串/空/超长）和内容扫描。
 * - **output 阶段** — 流式输出累积文本检查。同一检测器，不单独维护输出策略。
 *
 * ## 检测优先级
 *
 * 从高到低：self_harm > abuse > sexual_content > dangerous_behavior > violence > pii > prompt_injection。
 * 最高风险匹配后立即返回，不继续检查低优先级模式。这保证危重内容优先拦截。
 *
 * ## 输出安全性
 *
 * 对外只返回 `policyCode` 对应的固定文案，不拼接输入原文、命中片段、规则编号或检测器细节。
 * 防止攻击者通过响应文本反推绕过策略。
 */

import { z } from 'zod';

/** 与持久化契约共享的稳定值域；新增值必须同步迁移、Fixture 与告警。 */
export const teachingSafetyPhases = ['input', 'output'] as const;
export const teachingSafetyCategories = [
  'normal',
  'pii',
  'prompt_injection',
  'self_harm',
  'abuse',
  'sexual_content',
  'violence',
  'dangerous_behavior',
] as const;
export const teachingSafetyActions = ['allow', 'block', 'escalate'] as const;

export type TeachingSafetyPhase = (typeof teachingSafetyPhases)[number];
export type TeachingSafetyCategory = (typeof teachingSafetyCategories)[number];
export type TeachingSafetyAction = (typeof teachingSafetyActions)[number];

export const K12_SAFETY_POLICY_VERSION = 'k12-safety-v1' as const;
export const K12_SAFETY_DETECTOR_VERSION =
  'deterministic-k12-detector-v1' as const;

export const teachingSafetyPolicyCodes = [
  'k12_allowed',
  'k12_input_invalid',
  'k12_input_empty',
  'k12_input_too_large',
  'k12_pii_detected',
  'k12_prompt_injection_detected',
  'k12_self_harm_support',
  'k12_abuse_support',
  'k12_sexual_content_blocked',
  'k12_violence_blocked',
  'k12_dangerous_behavior_blocked',
] as const;

export type TeachingSafetyPolicyCode =
  (typeof teachingSafetyPolicyCodes)[number];

export const teachingSafetyDecisionSchema = z
  .object({
    phase: z.enum(teachingSafetyPhases),
    category: z.enum(teachingSafetyCategories),
    action: z.enum(teachingSafetyActions),
    policyVersion: z.literal(K12_SAFETY_POLICY_VERSION),
    detectorVersion: z.literal(K12_SAFETY_DETECTOR_VERSION),
    policyCode: z.enum(teachingSafetyPolicyCodes),
  })
  .strict();

/** 不含原文、命中片段、规则编号或模型推理，可直接映射到安全审计。 */
export type TeachingSafetyDecision = z.infer<
  typeof teachingSafetyDecisionSchema
>;

export const teachingSafetyLocales = ['zh-CN', 'en'] as const;
export type TeachingSafetyLocale = (typeof teachingSafetyLocales)[number];

export interface TeachingSafetyPublicResponse {
  locale: TeachingSafetyLocale;
  /** 只能来自本模块的固定文案，不允许拼接输入或检测器细节。 */
  text: string;
}

export type TeachingSafetyEvaluation<
  Phase extends TeachingSafetyPhase = TeachingSafetyPhase,
> =
  | {
      allowed: true;
      decision: TeachingSafetyDecision & {
        phase: Phase;
        category: 'normal';
        action: 'allow';
        policyCode: 'k12_allowed';
      };
    }
  | {
      allowed: false;
      decision: TeachingSafetyDecision & {
        phase: Phase;
        action: 'block' | 'escalate';
      };
      publicResponse: TeachingSafetyPublicResponse;
    };

export const K12_MAX_INPUT_CODE_POINTS = 4_000;
export const K12_MAX_INPUT_UTF8_BYTES = 16_000;

type BlockedPolicyCode = Exclude<TeachingSafetyPolicyCode, 'k12_allowed'>;

interface DetectedRisk {
  category: Exclude<TeachingSafetyCategory, 'normal'>;
  action: 'block' | 'escalate';
  policyCode: BlockedPolicyCode;
}

const PUBLIC_RESPONSES: Readonly<
  Record<TeachingSafetyLocale, Readonly<Record<BlockedPolicyCode, string>>>
> = Object.freeze({
  'zh-CN': Object.freeze({
    k12_input_invalid: '请输入文字问题，我们再一起学习。',
    k12_input_empty: '请输入一个具体问题，我们再一起学习。',
    k12_input_too_large: '这条消息太长了，请分成几个较短的问题再发送。',
    k12_pii_detected:
      '为了保护你的隐私，请删掉真实姓名、手机号、住址、证件号、密码或验证码后再发送。',
    k12_prompt_injection_detected:
      '我可以继续帮助你学习，但不能执行越过学习权限或改变系统约束的要求。请直接告诉我你想学习的问题。',
    k12_self_harm_support:
      '听起来你现在可能很难受。请马上告诉身边可信任的大人，例如家长、老师或学校辅导员，并尽量不要独处。如果你正面临立即危险，请联系当地紧急服务。',
    k12_abuse_support:
      '如果你或同学正在被伤害，这不是你的错。请尽快告诉可信任的家长、老师、学校辅导员或其他能保护你的大人；如果有立即危险，请联系当地紧急服务。',
    k12_sexual_content_blocked:
      '我不能提供不适合未成年人的露骨内容。如果你在学习青春期、身体健康或生物知识，可以换成科学、尊重且不包含个人隐私的问题。',
    k12_violence_blocked:
      '我不能帮助实施伤害他人的行为。我们可以改为讨论如何远离冲突、保护自己，或从安全角度学习相关知识。',
    k12_dangerous_behavior_blocked:
      '我不能提供可能造成受伤、违法或破坏安全措施的操作步骤。请在老师或监护人的指导下选择安全的学习活动。',
  }),
  en: Object.freeze({
    k12_input_invalid: 'Please enter a text question so we can learn together.',
    k12_input_empty:
      'Please enter a specific question so we can learn together.',
    k12_input_too_large:
      'That message is too long. Please split it into a few shorter questions.',
    k12_pii_detected:
      'To protect your privacy, remove real names, phone numbers, home addresses, identity numbers, passwords, or verification codes before sending.',
    k12_prompt_injection_detected:
      'I can keep helping with learning, but I cannot follow requests that bypass learning permissions or change system constraints. Please ask the learning question directly.',
    k12_self_harm_support:
      'It sounds like you may be having a very hard time. Please tell a trusted adult now, such as a parent, teacher, or school counselor, and try not to stay alone. If there is immediate danger, contact local emergency services.',
    k12_abuse_support:
      'If you or another student is being hurt, it is not your fault. Tell a trusted parent, teacher, school counselor, or another adult who can protect you. If there is immediate danger, contact local emergency services.',
    k12_sexual_content_blocked:
      'I cannot provide explicit content that is not appropriate for minors. For puberty, health, or biology, ask a scientific and respectful question without personal details.',
    k12_violence_blocked:
      'I cannot help carry out harm against another person. We can discuss staying safe, avoiding conflict, or learning about the topic from a safety perspective.',
    k12_dangerous_behavior_blocked:
      'I cannot provide steps that could cause injury, break the law, or bypass safety protections. Choose a safe learning activity with a teacher or guardian.',
  }),
});

const ZERO_WIDTH_CHARACTERS = /[\u200b-\u200d\u2060\ufeff]/g;

const normalizeForDetection = (input: string): string =>
  input
    .normalize('NFKC')
    .replace(ZERO_WIDTH_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const localeFor = (input: string): TeachingSafetyLocale =>
  /[\u3400-\u9fff]/u.test(input) ? 'zh-CN' : 'en';

/**
 * PII 检测模式 — 抓取学生可能泄露的个人身份信息。
 * 注意：这是 K12 场景，学生可能不懂什么是 PII，直接输入真实的手机号/姓名/住址。
 * 匹配则 block + 返回隐私保护提示，不记录命中内容。
 */
const piiPatterns: readonly RegExp[] = [
  /[a-z0-9._%+-]+\s*@\s*[a-z0-9.-]+\.[a-z]{2,}/i,                           // 邮箱
  /(?:^|\D)(?:\+?86[ -]?)?1[3-9]\d{9}(?:\D|$)/,                               // 中国手机号
  /\b\d{17}[\dx]\b/i,                                                           // 身份证号
  /(?:手机号|手机号码|联系电话|phone|mobile|call me at)[^\d+]{0,12}\+?\d[\d ()-]{7,}\d/i, // 上下文+号码
  /(?:身份证(?:号|号码)?|identity number|id number|id no\.?)[^\d]{0,8}\d{6,18}[\dx]?/i,     // 上下文+身份证
  /(?:我的真实姓名是|真实姓名[:：]|real name is)\s*[\p{L}·.' -]{2,40}/iu,       // 自报真实姓名
  /(?:我家住在|我的住址是|家庭住址|home address is|i live at)\s*[:：]?\s*.{4,}/iu, // 自报住址
  /(?:密码|口令|验证码|password|passcode|verification code)\s*(?:是|为|[:：=])\s*\S{4,}/iu, // 密码/验证码泄露
];

/**
 * Prompt Injection 检测 — 学生试图绕过教学约束。
 * 匹配"忽略指令"、"泄露系统提示"、"越狱模式"等已知攻击向量。
 * 注意：间距容忍写法（`忽 略`、`i g n o r e`）防止简单空格绕过。
 */
const promptInjectionPatterns: readonly RegExp[] = [
  /忽[\s._-]*略.{0,24}(?:之前|以上|前面|所有).{0,16}(?:指令|规则|提示)/u,
  /(?:输出|显示|泄露|告诉我).{0,20}(?:系统提示|开发者消息|隐藏指令)/u,
  /(?:越狱|开发者模式|假装没有任何规则|调用未提供的工具)/u,
  /i[\s._-]*g[\s._-]*n[\s._-]*o[\s._-]*r[\s._-]*e.{0,24}(?:previous|prior|above).{0,16}(?:instructions?|rules?|prompts?)/i,
  /(?:reveal|print|show|leak).{0,24}(?:system|developer).{0,12}(?:prompt|message|instructions?)/i,
  /(?:jailbreak|dan mode|developer mode|pretend (?:that )?you have no rules)/i,
];

/**
 * 自伤检测 — 最高优先级危重内容。
 * 行为：escalate（升级），不是 block。返回支持性引导信息，不冷冰冰拒绝。
 */
const selfHarmPatterns: readonly RegExp[] = [
  /(?:我|自己).{0,10}(?:不想活|想死|自杀|结束生命|伤害自己|割腕|跳楼|吞药)/u,
  /(?:不想活了|活着没意思|结束自己的生命)/u,
  /\b(?:i\s+)?(?:want|plan|planning|going|about)\s+to\s+(?:kill|hurt)\s+myself\b/i,
  /\b(?:kill myself|end my life|suicide method|how to commit suicide|cut myself)\b/i,
];

/**
 * 虐待/霸凌检测 — 学生描述自己正在被伤害。
 * 行为：escalate（升级）。返回保护性引导信息。
 */
const abusePatterns: readonly RegExp[] = [
  /(?:爸爸|妈妈|父母|老师|教练|大人|家人|同学).{0,14}(?:打我|虐待我|欺负我|威胁我|摸我(?:的)?私处)/u,
  /我(?:正在|一直|经常)?被.{0,14}(?:殴打|虐待|猥亵|欺负|威胁)/u,
  /\b(?:my|an?)\s+(?:parent|teacher|coach|adult|relative).{0,20}(?:hits|hurts|touches|threatens|abuses)\s+me\b/i,
  /\b(?:i am|i'm|i have been|i've been)\s+(?:being\s+)?(?:abused|molested|bullied|hit)\b/i,
  /\btouches?\s+my\s+private\s+parts\b/i,
];

/**
 * 色情内容检测 — 不适合未成年人的露骨内容请求。
 * 行为：block。注意：青春期/生物学的科学问题不应被误拦，
 * 目前的模式偏向拦截明显越界请求，会有漏报但有意识地避免误报。
 */
const sexualContentPatterns: readonly RegExp[] = [
  /(?:给我|发我|寻找|生成|写).{0,14}(?:色情|成人视频|裸照|露骨性内容)/u,
  /(?:未成年人|儿童).{0,12}(?:色情|性行为|裸照)/u,
  /\b(?:show|send|find|make|write)\b.{0,24}\b(?:porn|nudes?|explicit sexual content)\b/i,
  /\b(?:sexual content|sex)\s+(?:with|involving)\s+(?:a\s+)?(?:child|minor)\b/i,
];

/**
 * 危险行为检测 — 制作危险物品、绕过安全措施等。
 * 行为：block。
 */
const dangerousBehaviorPatterns: readonly RegExp[] = [
  /(?:如何|怎么|教我|步骤).{0,18}(?:制造|制作|配制).{0,14}(?:炸弹|爆炸物|毒药|枪支|武器)/u,
  /(?:绕过|关闭|拆除).{0,14}(?:实验室安全|安全装置|安全联锁|警报|门锁)/u,
  /\b(?:how (?:do i|to)|steps? to|teach me to)\b.{0,28}\b(?:make|build|mix)\b.{0,16}\b(?:bomb|explosive|poison|weapon)\b/i,
  /\b(?:bypass|disable|remove)\b.{0,18}\b(?:lab safety|safety interlock|alarm|lock)\b/i,
];

/**
 * 暴力内容检测 — 针对具体人的伤害意图。
 * 行为：block。
 */
const violencePatterns: readonly RegExp[] = [
  /(?:如何|怎么|教我).{0,14}(?:杀死|捅伤|枪击|勒死|袭击).{0,14}(?:人|同学|老师|家人|他|她)/u,
  /\b(?:how to|teach me to)\s+(?:kill|stab|shoot|strangle|attack)\b.{0,24}\b(?:someone|person|classmate|teacher|parent|him|her)\b/i,
];

const matchesAny = (input: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(input));

/**
 * 确定性安全检测 — 按优先级扫描，首个匹配后立即返回。
 *
 * ## 检测顺序（从高到低）
 *
 * 1. self_harm / abuse → escalate（必须升级，不能先被 block 拦截）
 * 2. sexual_content / dangerous_behavior / violence → block
 * 3. pii → block（在 injection 之前检测，隐私泄露比指令注入更紧急）
 * 4. prompt_injection → block（最后检测，最低优先级）
 *
 * 注意：self_harm 和 abuse 即使同时命中 pii，也走 escalate 而非 block。
 * 这保证危重内容不会被降级处理。
 */
const detectRisk = (normalized: string): DetectedRisk | null => {
  if (matchesAny(normalized, selfHarmPatterns)) {
    return {
      category: 'self_harm',
      action: 'escalate',
      policyCode: 'k12_self_harm_support',
    };
  }
  if (matchesAny(normalized, abusePatterns)) {
    return {
      category: 'abuse',
      action: 'escalate',
      policyCode: 'k12_abuse_support',
    };
  }
  if (matchesAny(normalized, sexualContentPatterns)) {
    return {
      category: 'sexual_content',
      action: 'block',
      policyCode: 'k12_sexual_content_blocked',
    };
  }
  if (matchesAny(normalized, dangerousBehaviorPatterns)) {
    return {
      category: 'dangerous_behavior',
      action: 'block',
      policyCode: 'k12_dangerous_behavior_blocked',
    };
  }
  if (matchesAny(normalized, violencePatterns)) {
    return {
      category: 'violence',
      action: 'block',
      policyCode: 'k12_violence_blocked',
    };
  }
  if (matchesAny(normalized, piiPatterns)) {
    return {
      category: 'pii',
      action: 'block',
      policyCode: 'k12_pii_detected',
    };
  }
  if (matchesAny(normalized, promptInjectionPatterns)) {
    return {
      category: 'prompt_injection',
      action: 'block',
      policyCode: 'k12_prompt_injection_detected',
    };
  }
  return null;
};

const allowedDecision = <Phase extends TeachingSafetyPhase>(
  phase: Phase,
): TeachingSafetyEvaluation<Phase> => ({
  allowed: true,
  decision: {
    phase,
    category: 'normal',
    action: 'allow',
    policyVersion: K12_SAFETY_POLICY_VERSION,
    detectorVersion: K12_SAFETY_DETECTOR_VERSION,
    policyCode: 'k12_allowed',
  },
});

const blockedEvaluation = <Phase extends TeachingSafetyPhase>(
  phase: Phase,
  locale: TeachingSafetyLocale,
  risk: {
    category: TeachingSafetyCategory;
    action: 'block' | 'escalate';
    policyCode: BlockedPolicyCode;
  },
): TeachingSafetyEvaluation<Phase> => ({
  allowed: false,
  decision: {
    phase,
    category: risk.category,
    action: risk.action,
    policyVersion: K12_SAFETY_POLICY_VERSION,
    detectorVersion: K12_SAFETY_DETECTOR_VERSION,
    policyCode: risk.policyCode,
  },
  publicResponse: {
    locale,
    text: PUBLIC_RESPONSES[locale][risk.policyCode],
  },
});

const exceedsInputLimit = (input: string): boolean => {
  if (input.length > K12_MAX_INPUT_UTF8_BYTES) return true;
  let codePoints = 0;
  let bytes = 0;
  for (const character of input) {
    codePoints += 1;
    const value = character.codePointAt(0) ?? 0;
    bytes += value <= 0x7f ? 1 : value <= 0x7ff ? 2 : value <= 0xffff ? 3 : 4;
    if (
      codePoints > K12_MAX_INPUT_CODE_POINTS ||
      bytes > K12_MAX_INPUT_UTF8_BYTES
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Provider 前的纯输入评估 — K12 安全防线。
 *
 * ## 检查流程
 *
 * 1. 类型检查 → 非字符串直接拒绝（invalid）
 * 2. 空字符串检查 → 拒绝（empty）
 * 3. 长度检查 → 超过 4000 code points 或 16KB UTF-8 拒绝（too_large）
 * 4. 内容扫描 → 按优先级检测风险内容
 * 5. 全部通过 → allowed
 *
 * 结果不包含输入原文、命中片段、规则编号或可逆摘要。
 * 对外只返回 policyCode，调用方查表获取固定文案。
 */
export function evaluateTeachingInput(
  input: unknown,
): TeachingSafetyEvaluation<'input'> {
  if (typeof input !== 'string') {
    return blockedEvaluation('input', 'zh-CN', {
      category: 'normal',
      action: 'block',
      policyCode: 'k12_input_invalid',
    });
  }
  const locale = localeFor(input);
  if (input.trim().length === 0) {
    return blockedEvaluation('input', locale, {
      category: 'normal',
      action: 'block',
      policyCode: 'k12_input_empty',
    });
  }
  if (exceedsInputLimit(input)) {
    return blockedEvaluation('input', locale, {
      category: 'normal',
      action: 'block',
      policyCode: 'k12_input_too_large',
    });
  }
  const risk = detectRisk(normalizeForDetection(input));
  return risk === null
    ? allowedDecision('input')
    : blockedEvaluation('input', locale, risk);
}

/** @internal 仅供流式输出 Gate 对已缓冲文本执行同一确定性策略。 */
export function evaluateTeachingOutputText(
  text: string,
): TeachingSafetyEvaluation<'output'> {
  const risk = detectRisk(normalizeForDetection(text));
  return risk === null
    ? allowedDecision('output')
    : blockedEvaluation('output', localeFor(text), risk);
}
