# Studio 笔记产物设计

**日期**: 2026-07-25
**状态**: 已批准，待实现

## 概述

为 EduCanvas Studio 新增 `note` 产物类型——支持 Markdown 笔记，AI 可从对话生成，学生也可手动创建和编辑。

## 创建方式

| 方式 | 入口 | 说明 |
|------|------|------|
| **AI 生成** | Composer + 菜单 → 「生成笔记」 | Agent 根据当前对话提炼结构化笔记，走确认→Worker生成→轮询 |
| **手动创建** | Studio 抽屉 → 「新建笔记」按钮 | 直接创建空笔记，进编辑器 |
| **从消息生成** | 消息气泡操作 → 「摘录为笔记」 | 把单条消息内容转成笔记（V2） |

V1 实现 AI 生成 + 手动创建。

## 数据模型

复用现有 Artifact 基础设施：

```typescript
// canvas-protocol 新增
kind: 'note'
contentVersion: 1
content: {
  markdown: string
  sourceConversationId?: string
  generatedByModel: boolean
}
noteContentSchema = z.object({
  markdown: z.string(),
  sourceConversationId: z.string().optional(),
  generatedByModel: z.boolean(),
}).strict()
```

产物元信息复用 `artifact_summary` 表，内容存 `artifact_versions` 表，与现有 mind_map/slides 完全相同。

## 编辑器

- 内嵌 Markdown 编辑器，分左右两栏（编辑 + 预览）
- 工具栏：H1-H3、粗体、斜体、无序列表、有序列表、代码块、链接、引用
- 自动保存：debounce 1.5s，每次保存写入新版本
- 版本历史：下拉菜单回溯，历史版本只读，切回最新版可继续编辑
- 编辑器在 Canvas 分屏区域打开（复用 ArtifactCanvas 布局）

## API 变更

### 现有端点复用
- `POST /api/v1/chat/artifacts` — `kind: 'note'` 加入 `CreatableArtifactKind`
- `GET /api/v1/chat/artifacts` — 列表含 note
- `GET /api/v1/chat/artifacts/:id` — 详情含 note 内容
- `PATCH /api/v1/chat/artifacts/:id` — 修改/新建版本

### 新增端点
- `PUT /api/v1/chat/artifacts/:id/note` — 手动保存笔记内容（创建新版本）
- `POST /api/v1/chat/artifacts` `{ kind: 'note', title, markdown?: string }` — 手动创建空笔记

## Worker 任务

`generate-artifact` 的 `note` 分支：调用模型根据对话历史生成结构化 Markdown 笔记，内容写入 `artifact_versions`。

## 前端变更

### 新增/修改文件

| 文件 | 变更 |
|------|------|
| `packages/canvas-protocol/src/artifacts/note.ts` | 新增 note schema |
| `packages/canvas-protocol/src/index.ts` | 导出 note schema |
| `apps/web/features/canvas/note-renderer.tsx` | 新增 Markdown 编辑器+预览渲染器 |
| `apps/web/features/canvas/artifact-generation-flow.tsx` | 注册 note renderer |
| `apps/web/features/canvas/artifact-client.ts` | `CreatableArtifactKind` 加 `'note'` |
| `apps/web/features/composer/plus-menu.ts` | 加 `create_note` action |
| `apps/web/features/workspace/general/general-chat-workspace.tsx` | 处理 `create_note` menu action |
| `apps/web/features/studio/studio-drawer.tsx` | 移除笔记占位图标，加「新建笔记」按钮，列表含 note 类型 |
| `apps/worker/src/tasks/generate-artifact.ts` | 加 note 生成分支 |
| `apps/web/app/api/v1/chat/artifacts/route.ts` | `kind: 'note'` 入允许列表 |

### NoteRenderer 功能

- 左栏 Textarea（编辑态）/ Markdown 渲染（阅读态）
- 右栏 Markdown 预览
- 顶部工具栏（Markdown 快捷插入）
- 底部「保存」按钮 + 自动保存指示器
- 版本选择器（复用 ArtifactCanvas 已有组件）
- 「AI 改写」输入框（复用现有 revise 流程）

## 范围边界

- V1: 基础 Markdown，不做富文本
- V1: 单人编辑，不做协作
- V1: 不做导出
- V1: 不做「从消息生成」

## 复用现有基础设施

- 产物生命周期：proposed → active → archived（ artifact_summary.status ）
- 不可变版本：artifact_versions 表
- AI 改写：现有 revise API
- Canvas 分屏布局：ArtifactCanvas
- 轮询机制：pollArtifactUntilSettled
