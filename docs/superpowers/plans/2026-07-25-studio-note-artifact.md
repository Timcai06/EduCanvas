# Studio 笔记产物 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 EduCanvas 新增 `note` 产物类型——支持 Markdown 笔记，AI 可从对话生成，学生也可手动创建和编辑。

**Architecture:** 沿袭现有 mind_map/slides 模式：canvas-protocol 加 schema → API 加 kind → Worker 加生成分支 → 前端加 renderer + menu action + studio 接入。区别：note 支持用户手动编辑保存（不走 worker）。

**Tech Stack:** TypeScript, Zod, React, react-markdown, remark-gfm

**Design Doc:** `docs/superpowers/specs/2026-07-25-studio-note-artifact-design.md`

## Global Constraints

- 沿袭现有 artifact 创建/列表/详情/修改 API 模式，不新增独立端点族
- `kind: 'note'` 信任层级为 `tier1`（纯 Markdown 文本，无脚本风险）
- 内容版本 schema 与 mind_map 同级：`NOTE_CONTENT_VERSION = 1`
- Worker 未配置模型时规则降级兜底（与 mind_map 一致）
- Markdown 渲染用 react-markdown + remark-gfm（项目已依赖）
- Studio 抽屉原有 6 个占位图标中「笔记」移除，接入真实功能

---

### Task 1: Note 内容 Schema（canvas-protocol）

**Files:**
- Create: `packages/canvas-protocol/src/artifacts/note.ts`
- Modify: `packages/canvas-protocol/src/index.ts`

**Interfaces:**
- Produces: `NoteContent` type, `noteContentSchema`, `NOTE_CONTENT_VERSION` 供后续所有层使用

- [ ] **Step 1: 创建 note schema 文件**

```typescript
// packages/canvas-protocol/src/artifacts/note.ts
import { z } from 'zod';

/** note 内容版本，初始为 1 */
export const NOTE_CONTENT_VERSION = 1;

export const noteContentSchema = z
  .object({
    contentVersion: z.literal(NOTE_CONTENT_VERSION),
    markdown: z.string(),
    sourceConversationId: z.string().optional(),
    generatedByModel: z.boolean(),
  })
  .strict();

export type NoteContent = z.infer<typeof noteContentSchema>;
```

- [ ] **Step 2: 从 index.ts 导出**

```typescript
// 加到 packages/canvas-protocol/src/index.ts
export {
  NOTE_CONTENT_VERSION,
  noteContentSchema,
  type NoteContent,
} from './artifacts/note';
```

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter @educanvas/canvas-protocol exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add packages/canvas-protocol/src/artifacts/note.ts packages/canvas-protocol/src/index.ts
git commit -m "feat: add note artifact content schema to canvas-protocol"
```

---

### Task 2: 前端类型层——启用 note 为可创建产物类型

**Files:**
- Modify: `apps/web/features/canvas/artifact-client.ts`

**Interfaces:**
- Consumes: `NoteContent` from Task 1
- Produces: `CreatableArtifactKind` 含 `'note'`，后续所有前端层使用

- [ ] **Step 1: 添加 'note' 到 CreatableArtifactKind**

```typescript
// apps/web/features/canvas/artifact-client.ts 第157行
export type CreatableArtifactKind =
  'mind_map' | 'slides' | 'flashcards' | 'audio_overview' | 'note';
```

- [ ] **Step 2: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无类型错误（可能在其他 switch 处报未处理 note——后续任务逐步覆盖）

- [ ] **Step 3: Commit**

```bash
git add apps/web/features/canvas/artifact-client.ts
git commit -m "feat: add 'note' to CreatableArtifactKind"
```

---

### Task 3: Plus Menu——加「生成笔记」入口

**Files:**
- Modify: `apps/web/features/composer/plus-menu.tsx`

**Interfaces:**
- Consumes: `PlusMenuActionId` 已定义，加 `'create_note'`
- Produces: 菜单项 `{ id: 'create_note', icon: NotePencil, label: '生成笔记', available: true }`

- [ ] **Step 1: 导入 NotePencil 图标**

```typescript
// plus-menu.tsx 第5行附近，已有 @phosphor-icons/react 导入
// 把 NotePencil 加入已有导入（NotePencil 已在该文件引用但未使用——实际上还没导入）
```

```typescript
import {
  BookOpen,
  FileArrowUp,
  ImageSquare,
  Plus,
  PresentationChart,
  Cards,
  Slideshow,
  TreeStructure,
  Headphones,
  NotePencil,  // 新增
} from '@phosphor-icons/react';
```

- [ ] **Step 2: 添加 menu item**

```typescript
// 在 menuItems 数组中加入（在 'create_audio_overview' 之后）
{
  id: 'create_note',
  icon: NotePencil,
  label: '生成笔记',
  available: true,
},
```

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无类型错误。`create_note` 已是 `PlusMenuActionId` 成员（第32行 `| 'more_tools'` 之后需加 `| 'create_note'`）

```typescript
// 第21-32行，类型定义需更新
export type PlusMenuActionId =
  | 'upload_file'
  | 'upload_image'
  | 'create_mind_map'
  | 'create_flashcards'
  | 'create_audio_overview'
  | 'pick_course_material'
  | 'add_link'
  | 'create_demo'
  | 'create_slides'
  | 'create_quiz'
  | 'create_note'    // 新增
  | 'more_tools';
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/composer/plus-menu.tsx
git commit -m "feat: add 'create_note' to plus menu"
```

---

### Task 4: API Route——允许创建 note 产物

**Files:**
- Modify: `apps/web/app/api/v1/chat/artifacts/route.ts`

**Interfaces:**
- Consumes: `NoteContent` schema from Task 1
- Produces: POST 端点接受 `kind: 'note'`

- [ ] **Step 1: 添加 note 到 createArtifactSchema**

```typescript
// 在 createArtifactSchema discriminated union 的第一项中加入 'note'
const createArtifactSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.enum(['mind_map', 'slides', 'flashcards', 'note']),
      title: titleSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('audio_overview'),
      title: titleSchema,
      sources: z.array(assetVersionReferenceSchema).min(1).max(8),
    })
    .strict(),
]);
```

- [ ] **Step 2: 设置 trustTier**

```typescript
// 第145行 trustTier，note 是 tier1（纯 Markdown 文本）
trustTier: parsed.data.kind === 'audio_overview' ? 'tier2' : 'tier1',
// 无需修改——note 走 tier1 分支
```

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/v1/chat/artifacts/route.ts
git commit -m "feat: allow 'note' kind in artifact creation API"
```

---

### Task 5: Worker——Note AI 生成

**Files:**
- Create: `apps/worker/src/tasks/note-generation.ts`
- Modify: `apps/worker/src/tasks/generate-artifact.ts`

**Interfaces:**
- Consumes: `NoteContent` from Task 1
- Produces: `generateNoteContent()` 函数

- [ ] **Step 1: 创建 note-generation.ts**

```typescript
// apps/worker/src/tasks/note-generation.ts
import type { StructuredModelGateway } from '@educanvas/agent-core';
import { noteContentSchema, type NoteContent } from '@educanvas/canvas-protocol';

export const NOTE_PROMPT_VERSION = 'artifact-note-v1';
export const NOTE_REVISION_PROMPT_VERSION = 'artifact-note-revision-v1';

export const RULE_GENERATOR = 'rule:note-outline-v1';
export const MODEL_GENERATOR = 'model:artifact.generate:note-v1';
export const RULE_REVISION_GENERATOR = 'rule:note-revision-v1';
export const MODEL_REVISION_GENERATOR = 'model:artifact.generate:note-revision-v1';

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
    // 规则降级：把对话转成 Markdown 格式笔记
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
          input.revision ? '保留未被要求改变的部分结构。' : '',
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
```

- [ ] **Step 2: 修改 generate-artifact.ts**

```typescript
// apps/worker/src/tasks/generate-artifact.ts

// 1) 新增加导入
import { generateNoteContent } from './note-generation.js';

// 2) 添加 'note' 到 supportedKinds（第288-293行）
const supportedKinds = [
  'mind_map',
  'slides',
  'flashcards',
  'audio_overview',
  'note',
] as const;

// 3) 添加 note 生成分支（在第366行 generateFlashcardsContent 之后）
// 把:
//   const { content, generatedBy } =
//     artifact.kind === 'mind_map'
//       ? await generateMindMapContent(generatorInput)
//       : artifact.kind === 'slides'
//         ? await generateSlidesContent(generatorInput)
//         : await generateFlashcardsContent(generatorInput);
//
// 改为:
const { content, generatedBy } =
  artifact.kind === 'mind_map'
    ? await generateMindMapContent(generatorInput)
    : artifact.kind === 'slides'
      ? await generateSlidesContent(generatorInput)
      : artifact.kind === 'flashcards'
        ? await generateFlashcardsContent(generatorInput)
        : await generateNoteContent(generatorInput);
```

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter worker exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/tasks/note-generation.ts apps/worker/src/tasks/generate-artifact.ts
git commit -m "feat: add note generation to worker"
```

---

### Task 6: NoteRenderer——Markdown 编辑器 + 预览

**Files:**
- Create: `apps/web/features/canvas/note-renderer.tsx`

**Interfaces:**
- Consumes: `NoteContent` from Task 1
- Produces: `NoteRenderer` 组件（编辑/预览双模式 + 手动保存）

- [ ] **Step 1: 创建 NoteRenderer**

```typescript
'use client';

import type { NoteContent } from '@educanvas/canvas-protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowCounterClockwise,
  Check,
  FloppyDisk,
  PencilSimple,
  Eye,
  TextHOne,
  TextHTwo,
  TextHThree,
  ListBullets,
  ListNumbers,
  CodeBlock,
  LinkSimple,
  Quotes,
  TextBolder,
  TextItalic,
} from '@phosphor-icons/react';

const AUTOSAVE_DELAY_MS = 1_500;

interface ToolbarAction {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  marker: string;    // 选中文本包裹前
  suffix?: string;   // 选中文本包裹后
  block?: boolean;   // 整行操作而非选中
}

const toolbarActions: readonly ToolbarAction[] = [
  { label: 'H1', icon: TextHOne, marker: '# ', block: true },
  { label: 'H2', icon: TextHTwo, marker: '## ', block: true },
  { label: 'H3', icon: TextHThree, marker: '### ', block: true },
  { label: '粗体', icon: TextBolder, marker: '**', suffix: '**' },
  { label: '斜体', icon: TextItalic, marker: '_', suffix: '_' },
  { label: '无序列表', icon: ListBullets, marker: '- ', block: true },
  { label: '有序列表', icon: ListNumbers, marker: '1. ', block: true },
  { label: '代码块', icon: CodeBlock, marker: '\n```\n', suffix: '\n```\n' },
  { label: '链接', icon: LinkSimple, marker: '[', suffix: '](url)' },
  { label: '引用', icon: Quotes, marker: '> ', block: true },
];

function insertMarkdown(
  textarea: HTMLTextAreaElement,
  marker: string,
  suffix?: string,
  block?: boolean,
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const insertion = block
    ? marker + selected
    : marker + selected + (suffix ?? marker);
  textarea.value = before + insertion + after;
  textarea.focus();
  const cursorPos = block
    ? start + marker.length + selected.length
    : start + marker.length + selected.length + (suffix ?? '').length;
  textarea.setSelectionRange(cursorPos, cursorPos);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function NoteRenderer({
  content,
  isLatest,
  readOnly = false,
  onSave,
  saving = false,
}: {
  content: NoteContent;
  isLatest: boolean;
  readOnly?: boolean;
  onSave?: (markdown: string) => void;
  saving?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [markdown, setMarkdown] = useState(content.markdown);
  const [preview, setPreview] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 版本切换时重置
  useEffect(() => {
    setMarkdown(content.markdown);
    setEditing(false);
  }, [content.markdown]);

  const canEdit = isLatest && !readOnly;
  const dirty = markdown !== content.markdown;

  const triggerAutosave = useCallback(
    (value: string) => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        if (onSave && value !== content.markdown) {
          onSave(value);
        }
      }, AUTOSAVE_DELAY_MS);
    },
    [onSave, content.markdown],
  );

  const handleSave = useCallback(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (onSave && dirty) onSave(markdown);
  }, [onSave, dirty, markdown]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 工具栏 */}
      {editing ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-2">
          {toolbarActions.map((action) => (
            <button
              key={action.label}
              type="button"
              title={action.label}
              onClick={() => {
                if (textareaRef.current) {
                  insertMarkdown(
                    textareaRef.current,
                    action.marker,
                    action.suffix,
                    action.block,
                  );
                  setMarkdown(textareaRef.current.value);
                }
              }}
              className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-strong hover:text-ink"
            >
              <action.icon size={16} />
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            title={preview ? '关闭预览' : '开启预览'}
            className={`grid size-8 place-items-center rounded-lg transition-colors ${
              preview ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-strong hover:text-ink'
            }`}
          >
            <Eye size={16} />
          </button>
          {readOnly ? null : (
            <>
              <span className="flex-1" aria-hidden="true" />
              <span className="text-xs text-ink-muted">
                {saving ? '保存中…' : dirty ? '未保存' : autosaveTimer.current ? '已自动保存' : '已保存'}
              </span>
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={handleSave}
                className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-card transition-colors hover:bg-accent-strong disabled:bg-surface-strong disabled:text-ink-faint"
              >
                <FloppyDisk size={14} />
                保存
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* 内容区：编辑 / 预览 */}
      <div className="min-h-0 flex-1">
        {editing && preview ? (
          <div className="flex h-full divide-x divide-line">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <textarea
                ref={textareaRef}
                value={markdown}
                readOnly={!canEdit}
                onChange={(e) => {
                  setMarkdown(e.target.value);
                  triggerAutosave(e.target.value);
                }}
                className="h-full w-full resize-none bg-transparent font-mono text-sm text-ink outline-none placeholder:text-ink-faint"
                placeholder="用 Markdown 写笔记…"
                aria-label="笔记编辑区"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <article className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {markdown}
                </ReactMarkdown>
              </article>
            </div>
          </div>
        ) : editing ? (
          <textarea
            ref={textareaRef}
            value={markdown}
            readOnly={!canEdit}
            onChange={(e) => {
              setMarkdown(e.target.value);
              triggerAutosave(e.target.value);
            }}
            className="h-full w-full resize-none bg-transparent p-4 font-mono text-sm text-ink outline-none placeholder:text-ink-faint"
            placeholder="用 Markdown 写笔记…"
            aria-label="笔记编辑区"
          />
        ) : (
          <div className="h-full overflow-y-auto p-4">
            <article className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {markdown}
              </ReactMarkdown>
            </article>
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2">
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              editing
                ? 'bg-accent text-card hover:bg-accent-strong'
                : 'bg-surface-strong text-ink hover:bg-line'
            }`}
          >
            {editing ? (
              <>
                <Check size={14} />
                完成编辑
              </>
            ) : (
              <>
                <PencilSimple size={14} />
                编辑
              </>
            )}
          </button>
        ) : null}
        {!isLatest ? (
          <span className="text-xs text-ink-muted">
            <ArrowCounterClockwise size={14} className="inline" /> 历史版本（只读）
          </span>
        ) : null}
        {readOnly ? (
          <span className="text-xs text-ink-muted">只读</span>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/features/canvas/note-renderer.tsx
git commit -m "feat: add NoteRenderer with markdown editor and preview"
```

---

### Task 7: ArtifactCanvas——注册 NoteRenderer

**Files:**
- Modify: `apps/web/features/canvas/artifact-generation-flow.tsx`

**Interfaces:**
- Consumes: `NoteRenderer` from Task 6

- [ ] **Step 1: 导入 NoteRenderer**

```typescript
// artifact-generation-flow.tsx 第29行附近
import { NoteRenderer } from './note-renderer';
```

- [ ] **Step 2: ArtifactCanvas 中渲染 note**

```typescript
// 在 ArtifactCanvas 的 render 区域添加 note 分支（第395-415行 switch 区域）
// 在第413行 } else if ... audio_overview 之后：
} else if (detail.artifact.kind === 'note' && detail.version) {
  <NoteRenderer
    key={displayedVersion}
    content={detail.version.content as NoteContent}
    isLatest={isLatest}
    readOnly={!isLatest}
    onSave={(markdown) => {
      // 手动保存：走 revise 流程
      if (onRevise) onRevise(`[手动编辑]\n${markdown}`);
    }}
  />
}
```

- [ ] **Step 3: 为 note 启用 revise**

```typescript
// 第341行，canRevise 加入 'note'
const canRevise = ['mind_map', 'slides', 'flashcards', 'note'].includes(
  detail.artifact.kind,
);
```

- [ ] **Step 4: 导入 NoteContent 类型**

```typescript
import type { NoteContent } from '@educanvas/canvas-protocol';
```

- [ ] **Step 5: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/canvas/artifact-generation-flow.tsx
git commit -m "feat: register NoteRenderer in ArtifactCanvas"
```

---

### Task 8: GeneralChatWorkspace——处理 create_note

**Files:**
- Modify: `apps/web/features/workspace/general/general-chat-workspace.tsx`

**Interfaces:**
- Consumes: `PlusMenuActionId` 含 `'create_note'`

- [ ] **Step 1: 添加 create_note 到 GENERAL_MENU_ACTIONS**

```typescript
// 第56-63行
const GENERAL_MENU_ACTIONS: readonly PlusMenuActionId[] = [
  'upload_file',
  'upload_image',
  'create_mind_map',
  'create_slides',
  'create_flashcards',
  'create_audio_overview',
  'create_note',     // 新增
];
```

- [ ] **Step 2: 处理 create_note action**

```typescript
// handleMenuAction 内（第193-208行），加入：
if (action === 'create_note') {
  artifactFlow.beginConfirm('note', '对话笔记');
}
// 放在 'create_audio_overview' 分支之后
```

```typescript
const handleMenuAction = useCallback(
  (action: PlusMenuActionId) => {
    if (action === 'upload_file') setAssetPanel('document');
    else if (action === 'upload_image') setAssetPanel('image');
    else if (action === 'create_mind_map') {
      artifactFlow.beginConfirm('mind_map', '对话思维导图');
    } else if (action === 'create_slides') {
      artifactFlow.beginConfirm('slides', '对话小结 Slides');
    } else if (action === 'create_flashcards') {
      artifactFlow.beginConfirm('flashcards', '复习闪卡');
    } else if (action === 'create_audio_overview') {
      artifactFlow.beginConfirm('audio_overview', '来源音频概览');
    } else if (action === 'create_note') {                          // 新增
      artifactFlow.beginConfirm('note', '对话笔记');                 // 新增
    }                                                                // 新增
  },
  [artifactFlow],
);
```

- [ ] **Step 3: ARTIFACT_KIND_LABELS 加入 note**

```typescript
// artifact-generation-flow.tsx 第45-50行
export const ARTIFACT_KIND_LABELS: Record<CreatableArtifactKind, string> = {
  mind_map: '思维导图',
  slides: 'Slides',
  flashcards: '闪卡',
  audio_overview: '音频概览',
  note: '笔记',     // 新增
};
```

- [ ] **Step 4: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/workspace/general/general-chat-workspace.tsx apps/web/features/canvas/artifact-generation-flow.tsx
git commit -m "feat: wire create_note action in general chat workspace"
```

---

### Task 9: Studio Drawer——移除笔记占位、接入真实笔记

**Files:**
- Modify: `apps/web/features/studio/studio-drawer.tsx`

**Interfaces:**
- Consumes: 现有 `StudioOutput` 接口，列表含 note 类型产物
- Produces: 无占位图标，点击笔记可打开编辑器

- [ ] **Step 1: 移除 NotePencil 占位图标**

```typescript
// UPCOMING_KINDS 数组中移除 { icon: NotePencil, label: '笔记' }
// 第24-31行改为：
const UPCOMING_KINDS: readonly { icon: Icon; label: string }[] = [
  { icon: Cards, label: '卡片' },
  { icon: Exam, label: '测验' },
  { icon: TreeStructure, label: '图解' },
  { icon: Waveform, label: '音频' },
  { icon: Trophy, label: '作品' },
];
```

- [ ] **Step 2: 去掉 NotePencil 导入**

```typescript
// 第9行附近，从导入中移除 NotePencil（现在只用于占位，移除后不再需要）
// 如果其他占位图标还需要用，保留其他
```

- [ ] **Step 3: 按 kind 显示不同图标**

```typescript
// 在 StudioDrawer 组件中，根据 output.kind 显示不同图标
// 第54-59行 PresentationChart 替换为根据 kind 选择图标
const kindIcon: Record<string, Icon> = {
  note: NotePencil,
  mind_map: TreeStructure,
  slides: Slideshow,
  flashcards: Cards,
  audio_overview: Headphones,
};

// 在 map 中使用（第58行）:
<kindIcon icon={kindIcon[output.kind] ?? PresentationChart} />
```

但 `NotePencil` 等图标仍需导入——所以不删除导入，而是扩展使用。

- [ ] **Step 4: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add apps/web/features/studio/studio-drawer.tsx
git commit -m "feat: connect note to studio drawer, remove note placeholder"
```

---

### Task 10: Note 的 API——支持手动保存（不通过 Worker 生成）

**Files:**
- Modify: `apps/web/app/api/v1/chat/artifacts/route.ts`
- 或创建: `apps/web/app/api/v1/chat/artifacts/[id]/note/route.ts`

**Context:** note 的编辑保存不应走 worker（只是存 Markdown 文本），需要直接写版本。

最简单方案：POST 创建 note 时支持可选 `markdown` 字段；PATCH 保存时直接调用 repository.appendVersion。

- [ ] **Step 1: POST 端点支持 note 手动创建**

```typescript
// 修改 createArtifactSchema，note 支持可选 markdown 字段
z
  .object({
    kind: z.enum(['mind_map', 'slides', 'flashcards', 'note']),
    title: titleSchema,
    markdown: z.string().optional(),  // note 手动创建时的初始内容
  })
  .strict(),
```

当 `kind === 'note' && markdown` 时，创建产物后直接 append 初始版本，不走 worker job。

- [ ] **Step 2: 在 POST handler 中处理 note 手动创建**

```typescript
// 在 `if (parsed.data.kind === 'audio_overview')` 块之后，加入：
if (parsed.data.kind === 'note' && parsed.data.markdown !== undefined) {
  const repository = new DrizzlePlatformArtifactRepository();
  const created = await repository.createArtifactWithGenerationJob({
    spaceId: conversation.spaceId,
    conversationId: conversation.id,
    trustedSubjectId: identity.studentId,
    kind: 'note',
    trustTier: 'tier1',
    title: parsed.data.title,
    taskIdentifier: ARTIFACT_GENERATE_TASK,
    params: {},
  });
  // 直接写入内容作为第一版，然后标记 job 完成
  await repository.appendVersion({
    artifactId: created.artifact.id,
    trustedSubjectId: identity.studentId,
    content: {
      contentVersion: 1,
      markdown: parsed.data.markdown ?? '',
      generatedByModel: false,
    } satisfies NoteContent,
    generatedBy: 'user:manual',
    generationJobId: created.job.id,
  });
  await repository.transitionGenerationJob({
    jobId: created.job.id,
    trustedSubjectId: identity.studentId,
    to: 'succeeded',
    progress: 100,
  });
  return Response.json(
    {
      artifact: {
        id: created.artifact.id,
        kind: created.artifact.kind,
        trustTier: created.artifact.trustTier,
        title: created.artifact.title,
        status: 'active' as const,
        latestVersion: 1,
      },
      job: { id: created.job.id, status: 'succeeded' as const },
    },
    { status: 201 },
  );
}
```

- [ ] **Step 3: 验证编译 + E2E（若有）**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/v1/chat/artifacts/route.ts
git commit -m "feat: support manual note creation without worker"
```

---

### Task 11: Studio Drawer——「新建笔记」按钮

**Files:**
- Modify: `apps/web/features/studio/studio-drawer.tsx`

**Interfaces:**
- Produces: `onCreateNote` callback

- [ ] **Step 1: 添加 onCreateNote prop 和按钮**

```typescript
// StudioDrawer props 新增 onCreateNote
export function StudioDrawer({
  outputs,
  onOpen,
  onCreateNote,     // 新增
}: {
  outputs: readonly StudioOutput[];
  onOpen: (id: string) => void;
  onCreateNote?: () => void;     // 新增
}) {
  return (
    <div className="space-y-7">
      {/* 新建笔记按钮 */}
      {onCreateNote ? (
        <button
          type="button"
          onClick={onCreateNote}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-line p-3 text-left text-sm text-ink-muted transition-colors hover:border-accent/50 hover:text-accent"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-strong">
            <NotePencil size={20} />
          </span>
          <span className="font-medium">新建笔记</span>
        </button>
      ) : null}

      {/* 现有列表 */}
      <ul className="space-y-2">
        {/* ...existing code... */}
      </ul>

      {/* 更多形态 */}
      <div>{/* UPCOMING_KINDS without 笔记 */}</div>
    </div>
  );
}
```

- [ ] **Step 2: 在 GeneralChatWorkspace 中接线 onCreateNote**

```typescript
// general-chat-workspace.tsx 的 Sheet 区（第511-546行），StudioDrawer 使用处
<StudioDrawer
  outputs={studioItems.map((item) => ({
    id: item.id,
    title: item.title,
    kind: ARTIFACT_KIND_LABELS[item.kind as CreatableArtifactKind] ?? item.kind,
    status: item.status === 'active' ? '已完成' : '本课预置',
  }))}
  onOpen={(id) => {
    setStudioOpen(false);
    void artifactFlow.openArtifact(id);
  }}
  onCreateNote={async () => {
    setStudioOpen(false);
    // 调用 artifact-client 创建空笔记
    const { createArtifact } = await import('@/features/canvas/artifact-client');
    try {
      const created = await createArtifact('note', '未命名笔记');
      void artifactFlow.openArtifact(created.artifact.id);
    } catch {
      // silently fail, user can retry
    }
  }}
/>
```

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add apps/web/features/studio/studio-drawer.tsx apps/web/features/workspace/general/general-chat-workspace.tsx
git commit -m "feat: add 'new note' button in studio drawer"
```

---

### Task 12: 端到端回归验证

**Files:** 无需修改，运行已有测试验证不破坏现有功能

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
pnpm typecheck
```
Expected: 全项目 0 类型错误

- [ ] **Step 2: 运行单元测试**

```bash
pnpm test
```
Expected: 所有已有测试通过

- [ ] **Step 3: 运行 E2E 测试（artifact flow）**

```bash
pnpm --filter web exec playwright test artifact-flow.spec.ts
```
Expected: 产物生成流程 E2E 不受影响

- [ ] **Step 4: Commit（如无修改则跳过）**

```bash
# 如有测试修正
git add -A && git commit -m "test: verify note artifact doesn't break existing tests"
```

---

## 实现顺序依赖图

```
Task 1 (schema)
  └─> Task 2 (types)
        └─> Task 3 (menu)
              └─> Task 8 (workspace)
Task 1
  └─> Task 4 (API)
        └─> Task 10 (manual save API)
Task 1
  └─> Task 5 (worker)
Task 1
  └─> Task 6 (renderer)
        └─> Task 7 (ArtifactCanvas)
Task 6 + Task 7 + Task 8
  └─> Task 9 (studio drawer)
Task 9 + Task 10
  └─> Task 11 (new note button)
ALL
  └─> Task 12 (regression)
```

可并行：Task 3+4+5+6 在 Task 1+2 完成后可同时进行。
