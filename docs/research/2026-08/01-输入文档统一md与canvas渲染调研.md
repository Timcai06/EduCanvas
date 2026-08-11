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

> ⚠️ 许可注意（已核实）：**anydoc 为 MIT**（LICENSE 头 Sideguide Technologies Inc.，非此前误标的 AGPL）；markitdown MIT；**pandoc GPL-2.0+**；MinerU 许可待 A2 线确认。

### 对比矩阵（调研中，逐步填充）

**A. 文档→Markdown 转换工具**（三列绿色=进程内 Node 方案；后三列为 Python 独立服务方案）

| 维度 | anydoc | pandoc | markitdown | docling | marker | MinerU | mammoth(已用) |
|------|--------|--------|-----------|---------|--------|--------|---------------|
| 输入格式 | 14 类(doc/docx/ppt/pptx/xls/xlsx/odt/ods/odp/rtf/epub/csv/pdf文本层) | 40+ 标记格式，**无 PDF 输入** | PDF/ppt/docx/xlsx/xls/图片/音频/html/csv/epub | PDF/DOCX/PPTX/XLSX/HTML/EPUB/LaTeX/图片/邮件等(广) | PDF/图片/PPTX/DOCX/XLSX/HTML/EPUB | PDF 为主+office原生(DOCX/PPTX/XLSX) | DOCX |
| md 保真度 | 最高(盲评81)；标题/表格(合并格)/列表/脚注/备注/图片alt；**无公式**；扫描PDF另接OCR | 高且确定；**唯一原生公式(OMML→TeX)**；docx表格列宽未实现 | 中等(65)；docx走mammoth；PDF词坐标猜表格 | 中(50.3 benchmark)；公式/多栏/扫描弱项 | 高(自报76，自家基准需保留)；表格启发式+VLM | **最强**：中文/公式/表格/扫描最优；专用表格双模型+公式模型+阅读序 | 纯文本 |
| 依赖/语言 | **Rust→napi-rs 原生.node 插件，进程内跑** | Haskell(CLI/pandoc-server/WASM) | Python(CLI/微服务) | Python(torch/onnx) | Python+**vLLM/llama.cpp 推理服务** | Python(torch/onnxruntime/PaddleOCR) | JS |
| 许可 | **MIT** | **GPL-2.0+** | MIT | **MIT** | 代码Apache-2.0，**模型权重OpenRAIL-M商用受限** | Apache2.0+附加条款(**在线服务须署名**，<1亿MAU/<2000万美元免费商用) | 待核实 |
| 维护活跃度 | 13.6k★，极活跃 | 45.8k★，极活跃 | 172.9k★，极活跃 | 64.6k★，极活跃 | 38.7k★，活跃 | 77.3k★，极活跃 | — |
| 服务端可跑性 | **进程内 Node≥20，无阻塞** | 子进程/pandoc-server sidecar | 需 Python 运行时 | **独立服务** docling-serve(FastAPI/Redis队列) | 独立服务 + GPU 推理 | **独立服务** mineru-api(异步/tasks)，可路由多GPU | 已用 |
| 资源消耗 | 无（原生库） | 无 | 无 | CPU可行，模型~1GB | 需 GPU(vLLM)或CPU fast模式 | pipeline: 4GB显存或纯CPU，模型实下~1.5-2GB | — |
| 安全 | 无网络；硬资源上限防zip炸弹；错误分类细 | pandoc-server 零I/O沙箱；Lua filter禁用 | 自警SSRF；无硬上限 | 离线可跑；无远程服务 | 离线；需本地推理运行时 | 完全离线可跑；ModelScope适配国内 | — |

**A 线结论**（初版分析；2026-08-11 MinerU 深调后，最终输入侧推荐收敛为 **MinerU 单引擎**，见本文件第五节与 02-doc 引擎能力覆盖表）：
1. **进程内首选 anydoc**（MIT、Node 原生插件、14 格式含 PDF、质量第一），最小侵入替换现有 mammoth 纯文本管线
2. **公式是共同缺口**：anydoc/markitdown 无公式；pandoc 唯一原生支持（GPL 但可 sidecar 调用）；若 K12 文档强依赖公式需补 pandoc 或 MinerU
3. **扫描 PDF / 中文教学文档**：三家 Python 工具都需独立转换服务（sidecar REST）——按中文 K12 场景**优先 MinerU pipeline 后端**（中文OCR/公式/表格针对性最强、纯CPU可跑、许可规模内免费但**在线服务须署名**）；**docling 为 MIT 宽松备选**（多格式覆盖、工程化最规整）；**marker 不建议**（模型权重商用受限）
4. 可选组合：**anydoc 做常规格式进程内转换 + MinerU/docling 做扫描/复杂 PDF 的独立服务**（深调后：anydoc 无公式无 OCR，被 MinerU office/pipeline 覆盖，不再进入主路线）

**B. Mermaid 渲染接入**

| 维度 | mermaid.js | rehype-mermaid | remark-mermaid(mauvm/已死) | kroki | mermaid-cli |
|------|-----------|----------------|---------------------------|-------|-------------|
| 渲染位置 | **纯客户端 JS**（必须 DOM，无官方 Node SSR） | 服务端预渲染（playwright） | 服务端(mermaid-cli)或客户端 | 外部服务/独立容器聚合器 | 服务端（puppeteer headless） |
| 安全模型 | `securityLevel` 4档(strict默认/antiscript/loose/sandbox)；**默认 secure 数组含 securityLevel，`%%{init}%%` 无法降级**（已核实 schema）；DOMPurify 洗 SVG（官方自认有洞）；SSRF 不防护 | 4策略：inline-svg最弱/`img-svg`/`img-png`强；不强制锁 securityLevel；playwright `bypassCSP:true` | 过时，仅形态参考 | **最强**：fail-closed SafeMode + request interception 网络白名单(仅file:/data:/同源/白名单，其余abort，已核实) + 配置锁死(忽略 securityLevel/maxTextSize 等用户输入) + 50k 上限 | 只拦截本地文件，**不阻断外部网络**（SSRF 需自防）；不锁 securityLevel |
| 与 react-markdown 集成 | 自研组件/rehype 插件调 `mermaid.render` | rehype 插件，`rehypePlugins={[rehypeMermaid]}` 直接用（须服务端/构建时） | remark 插件(mdast→mdast)，react-markdown 用不上 | HTTP API 外部调用 | 库 `renderMermaid()` 可作自研 rehype 插件底层引擎 |
| 依赖重量 | **3.57MB min(~1MB gzip)**，客户端负担重 | 重：playwright+chromium | 重 | 重：Java 服务+每图一容器 | 重：puppeteer+chrome |
| 活跃度 | ★★★ 89.7k★，2026-08 | ★★ 192★，2026-04 | ✗ 0★，2019 死 | ★★★ 4.3k★，2026-08 | ★★★ 4.9k★，2026-08 |

**B 线结论（安全机制已源码核实）**：
1. **首选 Tier 1：服务端预渲染 SVG + `<img>` 呈现**——自研 rehype 插件 + headless 浏览器渲染服务，`mermaid.render()` 出 SVG 转 `data:image/svg+xml` 的 `<img>`（`<img>` 里 SVG 不执行 script，比 inline `<svg>` 硬）
2. **照抄 kroki 三道安全防线**（已核实源码）：① request interception 网络白名单断 SSRF（仅 file:/data:/同源/白名单）；② 配置锁死——保留 mermaid 默认 secure 数组 + 渲染接口忽略用户传入的 `securityLevel`/`maxTextSize`/`secure`；③ 资源上限（maxTextSize 50k、超时、并发信号量）
3. **客户端方案不推荐**：3.57MB 体积 + 需 `style-src 'unsafe-inline'` CSP；除非确需点击交互，才走 EduCanvas 既有 sandboxed iframe + 白名单组件路径
4. **新依赖需过 ADR**：Node 服务端引入 playwright/chromium（部署体积数百 MB）或外部渲染服务（对外网络依赖）

### 调研发现（主线 C 形态对标，已完成）

对标 NotebookLM / Obsidian / Heptabase / Napkin：

| 产品 | 输入策略 | 渲染形态 | 格式底层 | 对 EduCanvas 的启示 |
|------|----------|----------|----------|----------------------|
| NotebookLM | 广开格式(PDF/DOCX/MD/CSV/PPTX/ePub/URL/音频/图片)，RAG 式抽取，**保留原文件静态副本**，不承诺还原排版("查看器可与原文件不同") | 来源查看器 + AI 面板，非文档画布 | 抽取文本 | 输入层广开格式、md 归一化作为规范；原文件留作附件，md 只是渲染层+AI 层 |
| Obsidian | **md 是唯一文档格式**，导入工具转 md | 单笔记视图；md 里 fenced ```mermaid 客户端渲染 | 纯 md 文件(CommonMark+GFM) | Mermaid 姿势：```mermaid 代码块 + 客户端渲染 + 锁死 `securityLevel: strict` + Secure Array 防 `%%{init}%%` 降级 + 产物消毒 + 进 sandboxed iframe（Docmost 有此类 XSS 前科） |
| Heptabase | 卡片+无限白板，白板是综合思考层 | 卡片铺白板 | **ProseMirror JSON**，md 只是导出格式 | 反例：文档一旦结构化(块注解/卡片属性)，md 往返有损；EduCanvas 若只做文档视图，**内部 md→AST→块 渲染，永远保有 md 导出** |
| Napkin | 粘贴文本/描述/导入 PDF/PPT/DOC | 文本→可编辑图表资产 | 非渲染语法 | 若走"模型自动配图"：**让模型产出 Mermaid 代码块**（而非直接调图服务），保留可编辑+可导出 |

**C 线关键结论**：
1. **输入统一 md 值得，但要分两层**：输入接受层像 NotebookLM 广开格式归一化为 md；存储/画布层以 md 为规范文档格式，原文件留作静态副本，避免"必须高保真还原原排版"的伪需求
2. **md 作为画布文档格式**优点成立（Obsidian 背书：纯文本/非专有/可 Git/LLM 友好）；代价是结构化后往返有损（Heptabase），故内部 md→AST→块 渲染、保有 md 导出能力
3. **Mermaid**：学 Obsidian 的 fenced 代码块 + 客户端渲染姿势；安全上锁死 securityLevel strict + 产物消毒 + **渲染器进 sandboxed iframe**（契合分层信任模型）
4. **渲染形态定位**：统一内容面板（一次开一个文档）最接近"Obsidian 单笔记视图 + NotebookLM 来源查看器"，不是 Heptabase 白板；将来要加白板应是独立于文档视图的第二层

### 集成落点（已核实现有源码）

「统一为带结构 Markdown」的最小改动落点在现有管线两端：

1. **抽取纯函数**：`packages/asset-processing/src/text-extraction.ts` 的 `extractAssetText(bytes, mimeType) → string`——目前 unpdf→纯文本、mammoth.extractRawText→纯文本、UTF-8 严格解码；`pdf_text_unavailable` 失败码已识别扫描件。**换装点**：anydoc 进程内替换 mammoth 分支，输出 GFM；扫描/复杂 PDF 分支可接 Python sidecar
2. **落库与表示**：`apps/worker/src/tasks/extract-asset-text.ts` 把输出以 `text/plain` 存 `derived/text/<sha>.txt` 并双写 `asset_versions.extracted_text`。**升级点**：输出内容类型改 `text/markdown`、存储键改 `.md`，并保留旧纯文本字段兼容读（类似 D04 的 compatibility 双写）
3. **渲染消费**：Source 渲染器 `apps/web/features/assets/source-resource-renderer.tsx` 已能渲染 `source.markdown`；服务端预览 `asset-preview.ts` 对 markdown 直接返回 extractedText。结构 md 落地后渲染侧几乎零改动，只需补 Mermaid

## 五、汇总推荐方案

### 输入侧（各格式 → 带结构 Markdown）：**MinerU 单引擎**（2026-08-11 深调后更新）

> 依据：MinerU 源码级深调（见 02-doc 引擎能力覆盖表）。核心支撑：office 后端零模型秒级、公式全覆盖（OMML→LaTeX / MFR）、五大后端统一输出契约、REST 异步任务协议、用户日常使用背书。

| 文档类型 | 方案 | 说明 |
|----------|------|------|
| docx/pptx/xlsx | **MinerU office 后端** | 纯解析零模型、秒级、读原生结构质量最高、公式 OMML→LaTeX；不受 GPU 影响 |
| PDF（文本层 / 扫描 / 公式 / 复杂版面） | **MinerU pipeline**（无 GPU，86.47）或 **hybrid**（GPU 8GB+，95.39） | 含 OCR、MFR 公式、表格识别；`pdf_text_unavailable`（扫描件）分支自然由 pipeline OCR 覆盖 |
| txt / md | 原样通过（MinerU pass-through 或 Node 侧直存） | 本就是 md，不重复转换 |
| 网页 → md | 待补一轮 mini 调研 | 现有 `web-page.ts` 只出纯文本；Node 侧需 `@mozilla/readability` + html→md，或复用 markitdown(Python)；见开放问题 |

> anydoc（MIT、进程内、无公式无 OCR）在深调后不再进入主路线：契约统一是核心目标，单引擎最干净；其能力被 MinerU office/pipeline 覆盖。仅作为可选纯文本快速路径留存备查。

### 渲染侧（md + Mermaid 在 Canvas 渲染）

- **Mermaid：Tier 1 服务端预渲染 SVG + `<img>` 呈现**——自研 rehype 插件，服务端 headless 渲染 `mermaid.render()` → `data:image/svg+xml` `<img>`；照抄 kroki 三道防线（网络白名单断 SSRF、配置锁死防降级、资源上限）
- **md 文档查看**：现有 `source-resource-renderer.tsx` / `note-renderer.tsx` 已渲染 md，补 Mermaid 插件即达"完整 md 文档（含图）"；渲染侧改动远小于输入侧
- 确需图表交互才走既有 sandboxed iframe + 白名单组件（Tier 2）

### 输出侧（统一 md）

- **现状已接近**：note artifact 原生 md、聊天消息全 md、Source md 已注册；模型输出 html 走沙箱预览
- 需评估：是否新增"文档 Artifact"类型（触碰 canvas-protocol 白名单 + ADR-0004），或让 `note` 承担完整文档角色——建议后续单独立项

### 落地顺序建议（供后续 plan 参考）

1. **Phase 1（输入统一 md）**：部署 `mineru-api` 独立服务（离线模型）→ worker 接入 REST 异步任务 → 输出落库改 `text/markdown`（含 `extracted_text` 兼容双写）→ 验证 docx/pdf 转换质量
2. **Phase 2（Mermaid 渲染）**：headless 渲染服务 + 自研 rehype 插件 + 防降级/SSRF/限流；接入 react-markdown 管线
3. **Phase 3（输出规范 + 新 artifact 判断）**：模型输出 md 规范 + 是否新增文档 Artifact
4. **新依赖/新服务需过 ADR**：MinerU Python sidecar 服务（含许可合规边界）、playwright/chromium 渲染服务

## 六、方法与产出物

1. **内部基线**：已完成（本文件第二节）
2. **外部调研**：分批并行 subagent，每类产出一张对比矩阵（功能/质量/依赖/许可/活跃度/契合度/安全），来源以官方仓库/文档/许可证/发布记录为准
3. **汇总**：推荐方案 + 与 ADR-0004/0009/0023 契合检查 + 开放问题
4. **产出物**：本文件收敛为最终调研报告（状态 draft → 供后续实现与 ADR 引用）

## 七、开放问题

- **部署硬件待确认**：mineru-api 跑在哪台机器、有无 GPU（决定 PDF pipeline 还是 hybrid）——见 02-doc 开放问题
- **网页→md 未深调研**：候选清单中 Readability/trafilatura/Jina Reader 未派专属 agent；需补一轮"Node 侧 html→md（readability + 转换器）vs markitdown(Python)"的 mini 调研
- **OCR→md 已由 MinerU 覆盖**：pipeline 后端具备 OCR 能力，扫描件自然走此路，不再单列
- **是否新增"文档 Artifact"类型**：触碰 canvas-protocol 白名单 + ADR-0004，需单独立项评估（当前 note 可先承担）
- **新依赖/服务需过 ADR**：MinerU Python sidecar 服务（含许可合规边界）、playwright/chromium 渲染服务
- 转换质量验证：需要 1-2 份真实样本文档（PDF + DOCX 含公式）在 Phase 1 实测
- anydoc 已退出主路线，仅作可选纯文本快速路径留存（见上输入侧说明）
- 报告落位与后续 PR 时机由用户决定

## 附录 A：anydoc vs MinerU 引擎对比（2026-08-11 源码核实）

> 背景：本轮输入侧决策的核心二选一。anydoc 为"轻量进程内快速路径"候选，MinerU 为"核心转换引擎"。本表逐项对比，每行附源码核实位置（克隆路径 `research-clones/20260811-input-md-canvas/`）。

| 维度 | anydoc | MinerU | 证据来源 |
|------|--------|--------|----------|
| 许可 | MIT，无附加条款，最干净 | Apache-2.0 + 附加条款（在线服务须署名；MAU>100M 或月收入>$20M 需商业授权） | `anydoc/LICENSE`；`MinerU/LICENSE.md` |
| 部署形态 | 进程内 npm 包，Node ≥ 20，预编译二进制（7 平台含 Linux/macOS/Windows × x64/aarch64 + musl） | 独立 Python 服务 `mineru-api`（FastAPI）+ 离线模型；CLI / Docker / 桌面端 | `anydoc/node/package.json`（napi targets）；`MinerU/mineru/cli/fast_api.py` |
| 集成方式 | 直接 `await toMarkdown(bytes)`，零网络、进程内、libuv 线程池不阻塞事件循环 | HTTP REST：multipart `POST /tasks` → 轮询 `GET /tasks/{id}` → 下载结果 zip | `anydoc/node/README.md`；`MinerU/mineru/cli/fast_api.py:1228-1352` |
| 资源需求 | 无系统依赖（纯 Rust）；无额外磁盘/内存 | 模型下载 ~2GB、磁盘 20GB+、内存 16GB 起 | `MinerU/README_zh-CN` + `mineru/utils/models_download_utils.py` |
| GPU | 完全不需要 | office+pipeline 不需要；**高精度 PDF 需 GPU 8GB+**（hybrid/vlm） | `MinerU/mineru/backend/office/docx_analyze.py`（零模型） |
| 格式覆盖 | 14 种：Word(.doc/.docx/.docm)、PPT、Excel、ODF、RTF、EPUB、CSV、PDF | docx / pptx / xlsx / pdf / txt / md | `anydoc/README.md` Supported formats；`MinerU/mineru/cli/common.py:633` |
| 转换质量 | 盲测 81 分（100 份真实文档，纯文本类文档；同类第一） | OmniDocBench：pipeline 86.47 / hybrid 95.39 / vlm 95.30 | `anydoc/README.md` Benchmark；`MinerU/README_zh-CN` |
| 数学公式 | ✗ 无 | ✓ docx OMML→LaTeX（`mineru/model/docx/tools/math/omml.py`）；PDF MFR 模型 | 源码核实 |
| 扫描件 / OCR | ✗ 无（OCR 仅在 Firecrawl 付费托管 API） | ✓ pipeline 内置 OCR，中文版面/公式针对性最强 | `anydoc/node/README.md`；`MinerU/enum_class.py ModelPath` |
| 中文文档 | 一般（无专门中文模型） | 强（CJK 语言专项、PaddleOCR 系、中文公式模型） | `MinerU/mineru/utils/enum_class.py` |
| 输出形态 | 单一 GFM Markdown | 结构化契约：`.md` + `content_list_v2.json`（按页分块）+ `middle.json` + `images/` | `MinerU/docs/zh/reference/output_files.md` |
| 表格 | GFM 管道表 | 原生 HTML（复杂表保真高，前端需清洗；pipeline 侧未做样式清洗） | `MinerU/backend/pipeline/pipeline_middle_json_mkcontent.py` |
| 并发 / 认证 | 无服务可运维，零成本 | 默认并发 3（`MINERU_API_MAX_CONCURRENT_REQUESTS`）；**无内置认证**需自建网关；结果保留 24h | `MinerU/mineru/cli/fast_api.py` |
| 坏文件处理 | reject + `error.code` 细分变体，颗粒度好 | 任务失败仅 `failed` + error 字符串，需 Node 侧解析分类 | `anydoc/node/README.md` Errors；`MinerU/mineru/cli/api_request.py` |
| 公式定界符 | —（无公式） | 默认 `$$/$`，**可配置**（自定义后前端渲染器须同步） | `MinerU/backend/pipeline/pipeline_middle_json_mkcontent.py` |

**结论**：anydoc 轻、快、免运维、许可干净，但正好缺失 K12 教学文档最需要的**数学公式**与**扫描件 OCR**；MinerU 公式/扫描/中文/结构化输出全覆盖，代价是独立 Python 服务与资源门槛。因此** MinerU 定为核心转换引擎**，anydoc 仅作可选纯文本快速路径（若引入，成本为一次 `npm install` + 一个 ADR）。
