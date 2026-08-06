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

| 能力                           | 源码位置                                                                                                     | 价值                                                                                   |
| :----------------------------- | :----------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| PDF 深度解析（布局识别 11 类） | `deepdoc/vision/layout_recognizer.py`                                                                        | 文本型 PDF 正文提取                                                                    |
| OCR（扫描件/乱码回退）         | `deepdoc/vision/ocr.py`                                                                                      | 扫描件处理                                                                             |
| 表格结构识别（TSR）            | `deepdoc/vision/table_structure_recognizer.py`                                                               | 表格转 HTML，citation 可溯源                                                           |
| XGBoost 跨页段落拼接           | `deepdoc/parser/pdf_parser.py:100`（模型经 HF `InfiniFlow/text_concat_xgb_v1.0` **运行时下载**，不在仓库内） | 跨页文本还原                                                                           |
| Markdown 元素化解析            | `deepdoc/parser/markdown_parser.py`                                                                          | header/fence/list/blockquote，保留结构——**正好对应我们 K 线语料（docs/ 全 markdown）** |
| 输出格式                       | `(sections, tables)` 元组，带 `@@页码\t坐标##` 位置标签                                                      | 喂给我们已有的 `pageStart/pageEnd` citation 字段                                       |

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

## 七、P1 实跑验证结论（2026-08-05 追加）

> 验证方法：ast 从 RAGFlow 源码原样提取 naive_merge 依赖树（10 个函数 + _BACKTICK_RE 常量，零抄写误差），在 torch_sm120 环境（Python 3.11 + tiktoken cl100k_base）实跑 4 个语义适配点。脚本保留在会话临时目录，可复现。

| 适配点          | 实跑结果                                                                             | 结论                                                                                                                               |
| :-------------- | :----------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| 1. 标题分块     | 4 个含标题 section → 1 个 chunk（81 tokens），标题 0 个独立                          | **naive_merge 不做标题识别**——标题层级必须靠解析层标记（deepdoc Markdown 元素化传标题 section，或 docx 的 Table Location caption） |
| 2. overlap 语义 | 0%→2 chunks 纯新段；50%→3 chunks 且 chunk[1] 以上一 chunk 尾部 B 开头                | overlap 生效但**仅当 overlap+t ≤ 预算**才应用，否则静默丢弃（与源码注释一致）                                                      |
| 3. token 口径   | 中文 51 字符→50 tokens（≈1.0 字符/token）；英文 74 字符→16 tokens（≈4.6 字符/token） | cl100k_base 与 Qwen/DeepSeek 系中文口径**差异显著**——抽取时必须替换 token 计数函数                                                 |
| 4. 反引号分隔符 | chunk_token_num=32 + `` `第 [0-9]+ 节` `` → 2 chunks（61/64 tokens，均 >32）         | 自定义分隔符绕过 token 上限、每段独立成 chunk，行为符合源码注释                                                                    |

### 抽取决策（由实跑结论推导）

- ✅ **可抽取**：naive_merge + delim.py + 辅助函数（~500 行，已实测可独立运行），适配点 2、4 行为符合预期
- ⚠️ **必须改造两点**：
  1. token 计数函数替换为我们模型 tokenizer（适配点 3）
  2. 标题分块依赖解析层配合（适配点 1）——deepdoc Markdown 元素化传标题 section，或自研标题感知分块

## 八、P0 合规核查结论（2026-08-05 追加）

> 验证方法：双 agent 独立核查（一个做 ONNX 二进制取证 + GitHub/HF API，另一个用 HF API 直接复核）+ 本地源码交叉验证。证据分级：直接证据（API 原始响应/二进制内嵌）/ 间接推断（第三方博客）。

### 结论：deepdoc 全套权重可在 EduCanvas（开源、可商用自托管）中使用，无 NC 组件

| 模型文件                               | 来源判定                                                            | 许可                                                                                    |
| :------------------------------------- | :------------------------------------------------------------------ | :-------------------------------------------------------------------------------------- |
| `det.onnx` / `rec.onnx` / `ocr.res`    | PaddleOCR PP-OCR 系 ONNX 化（二进制内嵌 "Model from PaddlePaddle"） | PaddleOCR 官方 Apache-2.0；HF 卡声明 apache-2.0                                         |
| `layout.onnx` + laws/manual/paper 变体 | YOLOv10 架构，InfiniFlow 自训                                       | HF 卡声明 apache-2.0（⚠️ 训练生态 AGPL，见风险）                                        |
| `tsr.onnx`                             | Ultralytics YOLOv8.1.18 训练，数据 PubTables-1M（二进制内嵌元数据） | **内嵌 `license: "Apache-2.0"`**；数据集 CDLA-Permissive-2.0（商用可用需署名）          |
| `updown_concat_xgb.model`              | InfiniFlow 自训 XGBoost（33 维特征）                                | 经 HF `InfiniFlow/text_concat_xgb_v1.0` 运行时下载（**不在仓库内**），卡声明 apache-2.0 |

**关键事实（直接证据）**：

- `InfiniFlow/deepdoc` 模型卡 license 字段 = `apache-2.0`（HF API cardData + README frontmatter 双确认）
- 权重文件实为 **8 个**（det/rec/ocr.res/layout×4/tsr），无独立 LICENSE 文件（HF 常见做法，但保留单方声明的不确定性）
- 上游 PP-OCRv4 系列 HF 卡均声明 apache-2.0；`PP-OCRv3_det` 卡 license 字段为空（None）但项目级 Apache-2.0 可覆盖

### ⚠️ 风险敞口（需 Code Owner 知悉）

1. **AGPL 训练生态争议**：layout/tsr 由 YOLOv10（THU-MIG，AGPL-3.0）与 Ultralytics YOLOv8 工具链（AGPL-3.0）产出。AGPL 文本未对权重归属表态（"输出仅在内容上构成 covered work 时才被本许可证覆盖"）——"权重=衍生作品"是法律争议，无明确 NC/AGPL 声明落在权重文件上。**RAGFlow 生态及众多商用产品均按 Apache-2.0 使用**；如法务从严，备选：PP-StructureV3 / Docling（MIT）/ MinerU（Apache-2.0）
2. **单方声明**：deepdoc 的 Apache-2.0 是 InfiniFlow 单方声明（卡片 frontmatter），仓库无独立 LICENSE 文件佐证
3. **bce 系列不在本次范围**：RAGFlow 默认 embedding/rerank 模型（bce-embedding-base_v1 等）上游许可未核实（BAAI 原版 401），若推广"无 NC"结论需另行核实——**但我们的 embedding 走自有 gateway（1536 维），不涉及**

### 需遵守的义务

1. Apache-2.0 再分发义务：保留版权声明与许可证副本（EduCanvas 自身 Apache-2.0，天然兼容）
2. 数据集署名：tsr.onnx 训练数据 PubTables-1M（CDLA-Permissive-2.0，需署名）——建议在模型清单文档中记录
3. 模型卡正文无训练数据披露（第三方 CSDN 称含 PubTables-1M/DocV3 等约 500 万样本，**未获官方证实，谨慎引用**）

### P0 完成 → 行动清单更新

- ✅ P0 合规检查完成（结论：可用，含 2 个风险敞口 + 2 个义务）
- P1 分块器评估完成（见 §七）
- 下一步：P1 设计解析服务接入链路（谁触发、怎么入队、结果怎么落库）
