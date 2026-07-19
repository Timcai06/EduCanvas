import type { StructuredModelGateway } from '@educanvas/agent-core';
import {
  FLASHCARDS_CONTENT_VERSION,
  flashcardsContentSchema,
  type FlashcardsContent,
} from '@educanvas/canvas-protocol';
import type { OutlineSourceMessage } from './mind-map-outline.js';
import type { ArtifactRevisionContext } from './mind-map-generation.js';

export const FLASHCARDS_PROMPT_VERSION = 'artifact-flashcards-v1';
export const FLASHCARDS_REVISION_PROMPT_VERSION =
  'artifact-flashcards-revision-v1';
export const FLASHCARDS_RULE_GENERATOR = 'rule:flashcards-v1';
export const FLASHCARDS_MODEL_GENERATOR =
  'model:artifact.generate:flashcards-v1';
export const FLASHCARDS_RULE_REVISION_GENERATOR = 'rule:flashcards-revision-v1';
export const FLASHCARDS_MODEL_REVISION_GENERATOR =
  'model:artifact.generate:flashcards-revision-v1';

const MAX_TRANSCRIPT_CHARS = 12_000;
const clip = (text: string, max: number): string => {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line || '(空内容)';
};

/** 规则版:学生问题为正面,对应回答首行为背面;无问答对时给一张占位说明卡。 */
export function buildRuleFlashcards(
  messages: readonly OutlineSourceMessage[],
): FlashcardsContent {
  const cards: FlashcardsContent['cards'] = [];
  let index = 0;
  for (const [position, message] of messages.entries()) {
    if (cards.length >= 40) break;
    if (message.role !== 'user') continue;
    const answer = messages[position + 1];
    if (!answer || answer.role !== 'assistant') continue;
    index += 1;
    cards.push({
      id: `c${index}`,
      front: clip(message.content, 200),
      back: clip(answer.content, 400),
    });
  }
  if (cards.length === 0) {
    cards.push({
      id: 'empty',
      front: '这次对话还没有可整理的问答',
      back: '先和 AI 聊几轮,再生成闪卡效果更好。',
    });
  }
  return flashcardsContentSchema.parse({
    contentVersion: FLASHCARDS_CONTENT_VERSION,
    cards,
  });
}

/** 与其他产物同一诚实三分支策略;失败不静默回退。 */
export async function generateFlashcardsContent(input: {
  title: string;
  messages: readonly OutlineSourceMessage[];
  gateway: StructuredModelGateway | null;
  traceId: string;
  operationId: string;
  revision?: ArtifactRevisionContext;
}): Promise<{ content: FlashcardsContent; generatedBy: string }> {
  if (!input.gateway) {
    if (input.revision) {
      const base = flashcardsContentSchema.parse(input.revision.baseContent);
      const cards = [...base.cards];
      if (cards.length >= 40) cards.pop();
      const usedIds = new Set(cards.map((card) => card.id));
      let revisionIndex = 1;
      while (usedIds.has(`revision-${revisionIndex}`)) revisionIndex += 1;
      cards.push({
        id: `revision-${revisionIndex}`,
        front: '本轮修改要求',
        back: clip(input.revision.instruction, 400),
      });
      return {
        content: flashcardsContentSchema.parse({ ...base, cards }),
        generatedBy: FLASHCARDS_RULE_REVISION_GENERATOR,
      };
    }
    return {
      content: buildRuleFlashcards(input.messages),
      generatedBy: FLASHCARDS_RULE_GENERATOR,
    };
  }
  let transcript = input.messages
    .map((m) => `${m.role === 'user' ? '学生' : 'AI'}: ${m.content}`)
    .join('\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
  }
  const result = await input.gateway.generateStructured({
    taskAlias: 'artifact.generate',
    modelAlias: 'structured',
    schema: flashcardsContentSchema,
    promptVersion: input.revision
      ? FLASHCARDS_REVISION_PROMPT_VERSION
      : FLASHCARDS_PROMPT_VERSION,
    traceId: input.traceId,
    operationId: input.operationId,
    messages: [
      {
        role: 'system',
        content: [
          input.revision
            ? '你是复习卡片撰写助手。请在当前闪卡基础上按用户要求修改，并返回完整的新版本。'
            : '你是复习卡片撰写助手。根据对话记录产出中文闪卡。',
          '每张卡:front 是一个可自测的问题(≤60字),back 是简洁准确的答案(≤200字);',
          '覆盖对话中的关键概念,难点可拆多张;8-20 张为宜;',
          'id 用小写字母数字连字符;contentVersion 固定 1;不要编造对话和修改要求之外的内容。',
          input.revision
            ? '保留未被要求改变的卡片；不要只返回差异或解释。'
            : '',
        ].join('\n'),
      },
      {
        role: 'user',
        content: input.revision
          ? `主题:${input.title}\n\n当前版本:\n${JSON.stringify(input.revision.baseContent)}\n\n修改要求:\n${input.revision.instruction}\n\nNotebook对话记录:\n${transcript}`
          : `主题:${input.title}\n\n对话记录:\n${transcript}`,
      },
    ],
  });
  return {
    content: result.output,
    generatedBy: input.revision
      ? FLASHCARDS_MODEL_REVISION_GENERATOR
      : FLASHCARDS_MODEL_GENERATOR,
  };
}
