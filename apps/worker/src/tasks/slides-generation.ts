import type { StructuredModelGateway } from '@educanvas/agent-core';
import {
  SLIDES_CONTENT_VERSION,
  slidesContentSchema,
  type SlidesContent,
} from '@educanvas/canvas-protocol';
import type { OutlineSourceMessage } from './mind-map-outline.js';
import type { ArtifactRevisionContext } from './mind-map-generation.js';

export const SLIDES_PROMPT_VERSION = 'artifact-slides-v1';
export const SLIDES_REVISION_PROMPT_VERSION = 'artifact-slides-revision-v1';
export const SLIDES_RULE_GENERATOR = 'rule:slides-v1';
export const SLIDES_MODEL_GENERATOR = 'model:artifact.generate:slides-v1';
export const SLIDES_RULE_REVISION_GENERATOR = 'rule:slides-revision-v1';
export const SLIDES_MODEL_REVISION_GENERATOR =
  'model:artifact.generate:slides-revision-v1';

const MAX_TRANSCRIPT_CHARS = 12_000;
const clip = (text: string, max: number): string => {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line || '(空内容)';
};

/** 规则版:每个"学生问题+回答"折叠为一页;封面页恒存在,保证 Schema 最少一页。 */
export function buildRuleSlides(
  title: string,
  messages: readonly OutlineSourceMessage[],
): SlidesContent {
  const slides: SlidesContent['slides'] = [
    { id: 'cover', title: clip(title, 80), bullets: [] },
  ];
  let index = 0;
  for (const [position, message] of messages.entries()) {
    if (slides.length >= 20) break;
    if (message.role !== 'user') continue;
    index += 1;
    const answer = messages[position + 1];
    const bullets =
      answer && answer.role === 'assistant'
        ? answer.content
            .split('\n')
            .map((line) => line.replace(/^[#>\-*\s]+/, '').trim())
            .filter((line) => line.length > 0)
            .slice(0, 8)
            .map((line) => clip(line, 160))
        : [];
    slides.push({ id: `s${index}`, title: clip(message.content, 80), bullets });
  }
  return slidesContentSchema.parse({
    contentVersion: SLIDES_CONTENT_VERSION,
    slides,
  });
}

/** 与 mind-map-generation 同一诚实三分支策略;失败不静默回退。 */
export async function generateSlidesContent(input: {
  title: string;
  messages: readonly OutlineSourceMessage[];
  gateway: StructuredModelGateway | null;
  traceId: string;
  operationId: string;
  revision?: ArtifactRevisionContext;
}): Promise<{ content: SlidesContent; generatedBy: string }> {
  if (!input.gateway) {
    if (input.revision) {
      const base = slidesContentSchema.parse(input.revision.baseContent);
      const slides = [...base.slides];
      if (slides.length >= 20) slides.pop();
      const usedIds = new Set(slides.map((slide) => slide.id));
      let revisionIndex = 1;
      while (usedIds.has(`revision-${revisionIndex}`)) revisionIndex += 1;
      slides.push({
        id: `revision-${revisionIndex}`,
        title: '本轮修改',
        bullets: [clip(input.revision.instruction, 160)],
      });
      return {
        content: slidesContentSchema.parse({ ...base, slides }),
        generatedBy: SLIDES_RULE_REVISION_GENERATOR,
      };
    }
    return {
      content: buildRuleSlides(input.title, input.messages),
      generatedBy: SLIDES_RULE_GENERATOR,
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
    schema: slidesContentSchema,
    promptVersion: input.revision
      ? SLIDES_REVISION_PROMPT_VERSION
      : SLIDES_PROMPT_VERSION,
    traceId: input.traceId,
    operationId: input.operationId,
    messages: [
      {
        role: 'system',
        content: [
          input.revision
            ? '你是演示文稿撰写助手。请在当前 Slides 基础上按用户要求修改，并返回完整的新版本。'
            : '你是演示文稿撰写助手。根据对话记录产出一份中文 Slides。',
          '第一页为封面(title=给定标题,bullets 为 2-3 条内容概览);',
          '其后每页聚焦一个主题:title 简洁(≤30字),bullets 3-6 条、每条一句话;',
          'id 用小写字母数字连字符;contentVersion 固定 1;总页数≤12;',
          '只使用对话与修改要求中的内容,不要编造。',
          input.revision
            ? '保留未被要求改变的页面；不要只返回差异或解释。'
            : '',
        ].join('\n'),
      },
      {
        role: 'user',
        content: input.revision
          ? `标题:${input.title}\n\n当前版本:\n${JSON.stringify(input.revision.baseContent)}\n\n修改要求:\n${input.revision.instruction}\n\nNotebook对话记录:\n${transcript}`
          : `标题:${input.title}\n\n对话记录:\n${transcript}`,
      },
    ],
  });
  return {
    content: result.output,
    generatedBy: input.revision
      ? SLIDES_MODEL_REVISION_GENERATOR
      : SLIDES_MODEL_GENERATOR,
  };
}
