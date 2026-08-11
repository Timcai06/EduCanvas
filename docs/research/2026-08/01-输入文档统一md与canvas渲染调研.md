# 输入文档统一为 Markdown 与 Canvas 渲染调研

- 状态：`draft`
- 负责人：hzlgou
- 创建时间：2026-08-11
- 相关分支：`docs/20260811-input-md-canvas-research`

## 一、调研定位

**目标**：为 EduCanvas 输出一份技术选型对比报告（本阶段不写代码），明确：

1. **输入侧**：各格式输入文档（PDF / DOCX / 网页 / 文本）→ 带结构 Markdown 的转换工具链选型（保留标题/表格/代码块层级，而不是现在的"收敛为纯文本"）
2. **渲染侧**：Markdown（含 Mermaid 图）在统一 Canvas 工作面里安全渲染的接入方案
3. **输出侧**：模型/系统输出统一为 Markdown 的规范（note 已有形态是否够用、是否需要新文档 Artifact 类型）

**范围边界**（明确做 / 不做）：

- ✅ 输入转换链路：PDF / DOCX / 网页 / 文本 → 带结构 Markdown
- ✅ Mermaid 渲染接入（react-markdown 生态 + 信任模型约束下）
- ✅ 现有 Canvas 内容面板增强：source / note 渲染器扩为完整 md 文档查看
- ✅ 内部可复用件盘点（已作为基线完成）
- ❌ OCR→md（可选扩展，仅列为开放问题）
- ❌ 自由白板形态（已确认排除）
- ❌ 写代码 / PoC（本阶段只出报告）

## 二、内部基线（现状地图）

> 已完成三路只读探索，以下为可复用的现成件与缺口。

### 已具备

- **渲染栈**：`react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex`，共享插件配置在 `apps/web/features/chat/math-markdown.ts`
- **Markdown 渲染三路径**：
  - 聊天消息：`apps/web/features/chat/markdown.tsx`（`MessageMarkdown`，不引入 rehype-raw，原始 HTML 一律不渲染）
  - 来源文档：`apps/web/features/assets/source-resource-renderer.tsx`（PDF/DOCX/Markdown/TXT/图片统一预览）
  - 笔记产物：`apps/web/features/canvas/note-renderer.tsx`（Markdown 编辑 + 实时渲染，textarea + 工具栏 + 1.5s 自动保存）
- **协议层**：`packages/canvas-protocol`，`source.markdown` 已注册进 Web Renderer Registry（`web-canvas-resource-registry-config.ts`）
- **文本抽取**：`packages/asset-processing/src/text-extraction.ts`（unpdf 抽 PDF、mammoth 抽 DOCX、UTF-8 抽文本），`apps/worker/src/tasks/extract-asset-text.ts` 异步队列
- **文件/网页入口**：`asset-upload-panel.tsx`、`source-link-import-panel.tsx`、`apps/web/server/assets/asset-upload.ts`、`apps/web/server/tools/web-page.ts`

### 关键缺口

1. **输入统一收敛的是"纯文本"不是 Markdown**：上传的 PDF/DOCX/Markdown 与网页正文最终都进 `asset_versions.extracted_text`，**Markdown 结构（标题/表格/代码块）丢失**
2. **Mermaid 完全没有**：无依赖、无渲染、无沙箱接入方案
3. **无"输入文档统一格式"的既有 PRD/ADR**：这是全新方向

### 架构约束（必须遵守）

- ADR-0004 / ADR-0009：分层信任模型；主页面不执行模型生成的任意 HTML/JS/GSAP；预注册 Renderer；不支持返回 unavailable 诚实失败
- Mermaid.js 本质是 JS 解析+渲染，其执行层落在哪一信任层（Tier 1 预渲染为 SVG / Tier 2 沙箱）是调研重点
- ADR-0023：Web features 静态边界

## 三、调研主线与研究问题

### 主线 A：输入侧「各格式 → 带结构 Markdown」

| 编号 | 研究问题 |
|------|----------|
| A1 | 候选工具横向对比（见外部项目清单）：功能覆盖、Markdown 结构保真度、依赖重量、许可、维护活跃度、与 TS 技术栈契合（服务端能否运行） |
| A2 | 扩展现有 `extract-asset-text.ts` 异步管线（纯文本 → 带结构 Markdown）的可行性 |
| A3 | 转换质量评估维度：标题层级 / 表格 / 代码块 / 图片引用 / 公式 的保真度 |

### 主线 B：渲染侧「Mermaid 安全接入 + md 文档查看增强」

| 编号 | 研究问题 |
|------|----------|
| B1 | Mermaid 在 react-markdown 生态的接入方式：`rehype-mermaid` / `remark-mermaid` / 自研组件 / 服务端预渲染为 SVG；以及 mermaid.js 执行 JS 的安全风险（XSS、SSRF）、落在 Tier 1 还是 Tier 2 |
| B2 | 现有 `source-resource-renderer.tsx` / `note-renderer.tsx` 增强为完整 md 文档查看器（目录、代码高亮、表格、公式、长文档性能） |
| B3 | 输出统一 md 的规范：模型输出约定、note 是否够用、是否需要新的文档 Artifact 类型（触碰 canvas-protocol 白名单 + ADR-0004） |

### 主线 C：形态对标（确认方向合理性）

- NotebookLM / Obsidian（md + mermaid 原生）/ Napkin / Heptabase 等「文档统一格式 + 画布渲染」产品形态对标

## 四、外部项目调研清单

> 按团队协作规则：外部项目**先 clone 到本地读源码再下结论**（网络走代理），禁止只凭网页/记忆下结论。

> **clone 存放位置**（用户手动可查，不进 git）：`/home/hzlgou/EduCanvas/research-clones/20260811-input-md-canvas/<项目名>`，每个项目 `git clone --depth 1`。

| 类别 | 候选项目 | 优先级 | 调研方式 |
|------|----------|--------|----------|
| PDF/DOCX→md | **firecrawl/anydoc**（用户指定参考）、pandoc、markitdown、docling、marker、MinerU（用户指定参考）、mammoth(已用) | 高 | clone + 源码/文档 |
| 网页→md | Readability、trafilatura、Jina Reader | 中 | clone + 文档 |
| Mermaid 渲染 | mermaid.js、rehype-mermaid、remark-mermaid、kroki、mermaid-cli | 高 | clone + 源码/文档 |
| 形态对标 | NotebookLM、Obsidian、Napkin、Heptabase | 低 | 文档调研即可 |

> ⚠️ 许可注意：anydoc 为 **AGPL-3.0**，MinerU、markitdown 等多为 MIT/Apache，落地时需评估与 EduCanvas 闭源/商用边界（服务化隔离可能缓解）。

### 对比矩阵（调研中，逐步填充）

**A. 文档→Markdown 转换工具**

| 维度 | anydoc | pandoc | markitdown | docling | marker | MinerU | mammoth(已用) |
|------|--------|--------|-----------|---------|--------|--------|---------------|
| 输入格式 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | DOCX |
| md 保真度 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 |
| 依赖/语言 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | JS |
| 许可 | AGPL | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 |
| 维护活跃度 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 |
| 服务端可跑性 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 | 已用 |

**B. Mermaid 渲染接入**

| 维度 | mermaid.js | rehype-mermaid | remark-mermaid | kroki | mermaid-cli |
|------|-----------|----------------|----------------|-------|-------------|
| 渲染位置(客户端/服务端) | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 |
| 安全模型 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 |
| 与 react-markdown 集成 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 |
| 依赖重量 | 待调研 | 待调研 | 待调研 | 待调研 | 待调研 |

## 五、方法与产出物

1. **内部基线**：已完成（本文件第二节）
2. **外部调研**：分批并行 subagent，每类产出一张对比矩阵（功能/质量/依赖/许可/活跃度/契合度/安全），来源以官方仓库/文档/许可证/发布记录为准
3. **汇总**：推荐方案 + 与 ADR-0004/0009/0023 契合检查 + 开放问题
4. **产出物**：本文件收敛为最终调研报告（状态 draft → 供后续实现与 ADR 引用）

## 六、开放问题

- OCR→md 是否纳入主调研线（当前不纳入）
- 是否有 1-2 份真实样本文档（PDF + DOCX）用于后续转换质量验证（报告阶段可延后）
- 报告落位与后续 PR 时机由用户决定
