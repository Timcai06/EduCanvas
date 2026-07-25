import type { StructuredModelGateway } from '@educanvas/agent-core';
import { noteContentSchema, type NoteContent } from '@educanvas/canvas-protocol';

export const NOTE_PROMPT_VERSION = 'artifact-note-v1';
export const NOTE_REVISION_PROMPT_VERSION = 'artifact-note-revision-v1';

export const RULE_GENERATOR = 'rule:note-outline-v1';
export const MODEL_GENERATOR = 'model:artifact.generate:note-v1';
export const RULE_REVISION_GENERATOR = 'rule:note-revision-v1';
export const MODEL_REVISION_GENERATOR =
  'model:artifact.generate:note-revision-v1';

export interface ArtifactRevisionContext {
  instruction: string;
  baseContent: unknown;
}

export interface OutlineSourceMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_TRANSCRIPT_CHARS = 12_000;

function buildTranscript(messages: readonly OutlineSourceMessage[]): string {
  const lines = messages.map(
    (message) =>
      `${message.role === 'user' ? '学生' : 'AI'}: ${message.content}`,
  );
  let transcript = lines.join('\n');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
  }
  return transcript;
}

export async function generateNoteContent(input: {
  title: string;
  messages: readonly OutlineSourceMessage[];
  gateway: StructuredModelGateway | null;
  traceId: string;
  operationId: string;
  revision?: ArtifactRevisionContext;
}): Promise<{ content: NoteContent; generatedBy: string }> {
  if (!input.gateway) {
    if (input.revision) {
      const base = noteContentSchema.parse(input.revision.baseContent);
      return {
        content: noteContentSchema.parse({
          ...base,
          markdown: `${base.markdown}\n\n---\n\n> 修改要求：${input.revision.instruction}`,
        }),
        generatedBy: RULE_REVISION_GENERATOR,
      };
    }
    const lines: string[] = [
      `# ${input.title}`,
      '',
      '## 对话摘要',
      '',
    ];
    for (const message of input.messages.slice(-20)) {
      const role = message.role === 'user' ? '学生' : 'AI';
      lines.push(`**${role}**：${message.content.slice(0, 500)}`);
      lines.push('');
    }
    return {
      content: noteContentSchema.parse({
        contentVersion: 1,
        markdown: lines.join('\n'),
        generatedByModel: false,
      }),
      generatedBy: RULE_GENERATOR,
    };
  }

  const result = await input.gateway.generateStructured({
    taskAlias: 'artifact.generate',
    modelAlias: 'structured',
    schema: noteContentSchema,
    promptVersion: input.revision
      ? NOTE_REVISION_PROMPT_VERSION
      : NOTE_PROMPT_VERSION,
    traceId: input.traceId,
    operationId: input.operationId,
    messages: [
      {
        role: 'system',
        content: [
          input.revision
            ? '你是知识整理助手。请在当前笔记基础上按用户要求修改，返回完整的新版本 Markdown 笔记。'
            : '你是知识整理助手。根据对话记录生成一份结构清晰的 Markdown 笔记。',
          '要求：使用标题层级（#, ##, ###）组织内容；提炼关键概念而非逐字照抄；',
          '使用列表、引用、代码块等 Markdown 语法增强可读性；',
          '总长度不超过 3000 字；不要编造对话中不存在的内容。',
          input.revision
            ? '保留未被要求改变的部分结构；不要只返回差异或解释。'
            : '',
        ].join('\n'),
      },
      {
        role: 'user',
        content: input.revision
          ? `标题：${input.title}\n\n当前笔记：\n${(input.revision.baseContent as NoteContent).markdown}\n\n修改要求：\n${input.revision.instruction}\n\n对话记录：\n${buildTranscript(input.messages)}`
          : `标题：${input.title}\n\n对话记录：\n${buildTranscript(input.messages)}`,
      },
    ],
  });
  return {
    content: { ...result.output, generatedByModel: true },
    generatedBy: input.revision ? MODEL_REVISION_GENERATOR : MODEL_GENERATOR,
  };
}
