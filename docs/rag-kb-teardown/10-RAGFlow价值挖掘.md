# 10 RAGFlow 价值挖掘：可直接使用的部分

- 状态：`draft`
- 负责人：hzlgou
- 最后验证时间：2026-08-05

> 结论先行：**RAGFlow 整体不可引入**（技术栈冲突 + 违反 KM 计划"不复制第二套检索基础设施"硬约束），但它内部有**两块可以拆出来直接用**的积木：`deepdoc` 解析层（已定方案）与 `naive_merge` 分块器（待评估）。本文记录全部"可直接使用部分"，每条标注来源位置、抽取成本、依赖与注意点。

## 零、整体判断（为什么只挖不搬）

| 判断           | 依据                                                                                                                                 |
| :------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| 检索编排不可用 | 两级加权魔法系数、无向量身份、fail-soft——我们 rrf-v1 + 五要素身份 + fail-closed 更严格（见 [08](./08-RAGFlow解析与分块对标.md) §六） |
| 基础设施不可搬 | ES/MySQL/Redis/MinIO 全套与 `CLAUDE.md:42`（pgvector 是事实源、无 Redis）冲突                                                        |
| **解析层可拆** | `deepdoc/` 是仓库内独立 Python 包（vision + parser），Apache-2.0                                                                     |
| **分块器可拆** | `naive_merge` 系列纯文本逻辑，无模型依赖，输入输出与解析层解耦                                                                       |

## 一、✅ 已定方案：deepdoc 解析层（作为 K 线第一块积木）

**用途**：把 PDF/Markdown 变成结构化文本段（带位置标签/HTML 表格），喂给我们 K02 摄取链路。检索仍走 pgvector + rrf-v1。

**来源**（`/home/hzlgou/ragflow`，commit `47a4ab1`，Apache-2.0）：

| 能力                           | 源码位置                                                                         | 价值                                                                                   |
| :----------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| PDF 深度解析（布局识别 11 类） | `deepdoc/vision/layout_recognizer.py`                                            | 文本型 PDF 正文提取                                                                    |
| OCR（扫描件/乱码回退）         | `deepdoc/vision/ocr.py`                                                          | 扫描件处理                                                                             |
| 表格结构识别（TSR）            | `deepdoc/vision/table_structure_recognizer.py`                                   | 表格转 HTML，citation 可溯源                                                           |
| XGBoost 跨页段落拼接           | `deepdoc/parser/pdf_parser.py`（模型 `rag/res/deepdoc/updown_concat_xgb.model`） | 跨页文本还原                                                                           |
| Markdown 元素化解析            | `deepdoc/parser/markdown_parser.py`                                              | header/fence/list/blockquote，保留结构——**正好对应我们 K 线语料（docs/ 全 markdown）** |
| 输出格式                       | `(sections, tables)` 元组，带 `@@页码\t坐标##` 位置标签                          | 喂给我们已有的 `pageStart/pageEnd` citation 字段                                       |

**接入方式**：作为独立 Python 服务（解析归 Python 生态，`docs/05-engineering/02-后端工程.md:101` 已约定），接进现有摄取 worker 链路。

**注意点**：

- ⚠️ **模型许可证待核实**：OCR/布局模型从 HF 拉 `InfiniFlow/deepdoc`（`layout_recognizer.py:65`），Apache-2.0 是代码许可，模型本身可能是另一套许可——**先于一切的合规检查**
- deepdoc 只解决"解析"，不解决"分块"（在 `rag/nlp/`）与"摄取链路编排"（我们 `knowledge:ingest_document` 入队方还不存在）

## 二、🔍 待评估：naive_merge 分块器（抽取成本低，语义适配待验证）

**用途**：分隔符 + token 预算贪心合并的通用分块算法。

**来源**：`rag/nlp/__init__.py:1294-1375`（`naive_merge`）+ 变体 `naive_merge_with_images`（:1378）、`naive_merge_docx`（:1762）

**抽取面（已实测）**：

| 组件       | 位置                                                                                                                        | 规模    |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------- | :------ |
| 核心函数   | `rag/nlp/__init__.py`（4 个函数）                                                                                           | ~500 行 |
| 分隔符解析 | `rag/nlp/delim.py`（`parse_delimiter_field`/`has_wrapped_delimiter`/`compile_delimiter_pattern`/`normalize_text_newlines`） | 170 行  |
| token 计数 | `common/token_utils.py`（tiktoken）                                                                                         | 185 行  |

**关键事实**：

- **纯文本逻辑，无模型/向量库依赖**（`_compute_chunk_update`/`_split_oversized_unit` 内 grep 无 model/torch/onnx）
- 输入 `(sections, positions)` 与 deepdoc 输出**天然解耦**，可独立抽取
- **反引号自定义分隔符绕 token 上限**（`naive_merge` :1322-1341）——"按结构切"与"按 token 切"双模式，值得参考
- 许可证 Apache-2.0，无法律障碍

**待验证的 4 个点**：

1. 标题分块语义：naive_merge 本身不做标题识别，依赖解析层标记——需验证与 deepdoc Markdown 元素化的组合效果
2. overlap 语义：RAGFlow 是"上 chunk 尾部字符百分比 + 超预算丢弃"（:1280-1284），与我们"保留年级/章节/知识点"的父子块思路不完全一致
3. token 口径：tiktoken 估算 vs 我们 DeepSeek/Qwen 系模型的 token 差异
4. 是否需要定制：K12 教材/产品文档的专用分块规则

## 三、✅ 思想借鉴（无代码，看设计）

| 设计                              | 来源                                                       | 借鉴点                                                                                                               |
| :-------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| 模板化分块（15 种方法）           | `rag/app/*.py`（book/laws/paper/manual/qa/table/one…）     | 按文档形态预设分块策略的思想——K00 定 allowlist 时同步记录"每个来源的文档形态"                                        |
| 父子块 `mom_with_weight` 冗余字段 | `task_executor.py:1300-1319` + `search.py:906-960`         | 子块存父块全文（冗余字段方案）vs LlamaIndex docstore 回查方案，二选一（见 [09](./09-LlamaIndex父子分块对标.md) §八） |
| LLM 富化参与检索加权              | `task_executor.py:443-497`（auto_keywords/auto_questions） | 中价值，需评估；注意 RAGFlow 的权重是硬编码魔法系数，我们做要按 ADR 定义可解释权重                                   |
| 位置元数据                        | `rag/nlp/__init__.py:931-943`（页码+bbox）                 | 我们 citation 已有页码维度，bbox 不需要                                                                              |

## 四、❌ 明确不使用

| 部分                    | 原因                                   |
| :---------------------- | :------------------------------------- |
| 混合检索（两级加权）    | 魔法系数、无版本防护，我们 rrf-v1 更强 |
| 向量设计（q_{dim}_vec） | 无身份五要素                           |
| 版本管理（全删重插）    | 我们"先写新后切读"                     |
| 引用（事后相似度）      | 我们白名单 + 快照校验                  |
| 全部基础设施            | ES/MySQL/Redis/MinIO，违反硬约束       |
| RAPTOR/GraphRAG         | 无评测证据，K03 评测集建好前不引入     |

## 五、行动清单

| 优先级 | 事项                                                                       | 前置           |
| :----- | :------------------------------------------------------------------------- | :------------- |
| P0     | 核实 deepdoc 模型（`InfiniFlow/deepdoc` HF 仓库）许可证                    | 无             |
| P1     | 评估 naive_merge 抽取（4 个语义适配点）                                    | P0             |
| P1     | 设计解析服务接入链路（谁触发、怎么入队、结果怎么落库）                     | P0             |
| P2     | 结合 [09](./09-LlamaIndex父子分块对标.md) 定父子块方案（冗余字段 vs 回查） | 分块器评估结论 |

## 六、一句话总结

> RAGFlow 的价值不在"整个系统"，而在**两块可拆的积木**：deepdoc 解析层（已定，K 线第一块积木）+ naive_merge 分块器（待评估，抽取成本 ~500 行无重依赖）。先过模型许可证合规，再定分块器语义适配，然后设计摄取链路——检索、身份、引用全部继续用我们自己的。
