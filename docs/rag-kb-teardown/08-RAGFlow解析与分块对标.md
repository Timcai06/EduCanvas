# 08 RAGFlow 解析与分块对标

- 状态：`draft`
- 负责人：hzlgou
- 最后验证时间：2026-08-05

> 基于 RAGFlow 官方仓库源码分析（commit `47a4ab1`，2026-08-04，本地浅克隆），结论全部标注 **[源码实证]** 或 **[文档声称]**。对标对象：EduCanvas KM 计划 K 线（产品知识 RAG）——仓库内目前**没有分块器**，文档解析归 Python 生态（`docs/05-engineering/02-后端工程.md:101`）。

## 一、RAGFlow 解析→分块总链路（源码实证）

```
DocumentService.start_parse（document_service.py:1222）
  → queue_tasks 切分任务入 Redis Stream（task_service.py:439）
  → TaskManager.run_refactored_task
  → ChunkService.build_chunks（chunk_service.py:91）
  → run_chunking → get_parser(parser_id).chunk(binary)（chunk_builder.py:39-68）
```

- 任务分派按 **parser_id**（不是扩展名），15 种方法（`common/constants.py:123-143`）：naive/paper/book/presentation/manual/laws/qa/table/resume/picture/one/audio/email/knowledge_graph/tag
- 文件内分派按扩展名正则（`rag/app/naive.py:950-1233`）：.docx→Docx、.pdf→PARSERS[layout_recognizer]、.md→Markdown、.xlsx→ExcelParser、.doc→tika 等

## 二、各格式解析路径（源码实证）

| 格式                | 解析器                                                           | 关键行为                                                                                                                                                                                   |
| :------------------ | :--------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF（默认 DeepDoc） | 深度流水线                                                       | pdfplumber 文本层 + **每页无条件 OCR**（PaddleOCR 系 ONNX）→ 布局识别（11 类标签）→ 表格结构识别 TSR（6 类）→ 文本合并 → **XGBoost 跨页段落拼接**（33 维特征模型）→ 表格转 HTML / 图片裁剪 |
| PDF（Plain Text）   | pypdf                                                            | 纯文本抽取，无 OCR/布局                                                                                                                                                                    |
| PDF（外部引擎）     | MinerU / Docling / OpenDataLoader / TCADP / SoMark / Mistral OCR | 全部归一化为 `(sections, tables)` 接口，与分块解耦                                                                                                                                         |
| Word .docx          | python-docx                                                      | 直接读 XML 结构；表格转 HTML 并附最近 Heading 标题链 caption（`Table Location: 文档名 > H1 > H2`）；分页符识别；图片抽取                                                                   |
| Markdown            | RAGFlowMarkdownParser                                            | 元素化（header/code fence/list/blockquote/paragraph）；表格抽离转 HTML；图片 URL 下载带 **SSRF 防护**；短标题（<50 token）强制与后段合并                                                   |
| Excel/CSV           | pandas                                                           | sheet 级表头解析、DataFrame 化、单元格图片 VLM 描述回填；任务按 3000 行切                                                                                                                  |

**关键事实**：

- **OCR 无"扫描件检测"开关**——DeepDoc PDF 路径每页无条件跑 OCR 并与文本层融合；乱码检测（PUA/CID 占比 ≥0.3 或字体编码乱码）时清空该页字符走纯 OCR。社区 README 的"自动检测"是宣传语（[源码实证] naive.py:721-727、pdf_parser.py:1637-1655）
- **公式无专门解析器**——全文未见 LaTeX/公式转换代码，公式按文本或图片处理（[源码实证] 反证社区"公式解析"宣传）；只有 DeepDoc 布局识别有 Equation 类别标签，MinerU/Docling 才输出 LaTeX（[文档声称]）
- Word/Markdown/Excel **不触发 OCR**（[源码实证]）

## 三、分块策略（源码实证，rag/nlp/**init**.py）

### naive 算法（默认，chunk_token_num=512）

1. 每 section 前加 `\n`，token 数 ≤ 预算直接并入当前 chunk
2. 超限按 delimiter 正则拆（默认 `\n!?。；！？`），贪心合并到上限
3. **反引号包裹的自定义分隔符（`` `Chapter [0-9]+` ``）绕过 token 上限**——每段独立成 chunk（naive.py:1322-1341）——这就是"按结构切块"的实现机制
4. 超长无分隔符文本 → 空白原子 + 字符窗口兜底二次切分
5. `overlapped_percent` 重叠：新 chunk 以旧 chunk 尾部字符百分比开头；**仅当 overlap+新片段不超预算才应用，否则丢弃 overlap**

### 模板化分块（15 种方法 = 按文档类型的模板）

- paper：提取标题/作者/摘要，摘要永不切分，按标题频度判 section，两栏按 (page,x,y) 重排
- book：目录页移除（contents/目录/目次 等标记，最多 128 行）、标题层级树合并（最多 5 级）
- table：**一行 = 一个 chunk**，每列角色 indexing/metadata/both，列按类型写类型化字段
- qa：正则抽取问答对；one：整篇一个 chunk
- 其余：laws（条文树 2 级）、manual（section 层级）、presentation（一页一个 chunk）等

### 父子块（源码实证，task_executor.py:1300-1319）

- `parser_config.parent_child.use_parent_child=true` 时启用
- `children_delimiter`（默认 `\n`，支持反引号正则）把大 chunk 再切为子 chunk
- **子 chunk 带 `mom_with_weight` 字段存父块全文**（冗余字段，不是独立父块表）
- 查询时 `retrieval_by_children` 把子 chunk 的 mom 找回替换（search.py:906-960）

### 保留的元数据（源码实证）

- 页码+坐标：`page_num_int`/`position_int`/`top_int`（PDF 文本内嵌 `@@页码\tleft\tright\ttop\tbottom##` 位置标签）
- **无结构化标题层级字段**——标题层级通过 hierarchical_merge 把标题行合并进 chunk 正文开头（book/laws/manual 专用）；通用 naive 不保留
- `title_tks` = **仅文件名**分词
- 类型标记 `doc_type_kwd`（table/image/toc）、图片 `img_id`（MinIO）
- LLM 富化（可选）：auto_keywords → important_kwd、auto_questions → question_tks，**参与检索加权**

## 四、检索编排（源码实证，rag/nlp/search.py）

### 混合检索 = 两级加权求和（**不是 RRF**，全仓库 grep 无 rrf）

1. **ES 侧**：`FusionExpr("weighted_sum", topk, {"weights": "0.001,1"})`（search.py:210）→ `vector_similarity_weight=1.0` → `bool_query.boost = 1-1 = 0`——**term 匹配只作召回过滤（minimum_should_match 30%），排序分数由 KNN cosine 决定**
2. **应用侧**：`sim = tkweight·tksim + vtweight·vtsim + rank_fea`
   - tkweight/vtweight 用户配置（默认 vector_similarity_weight=0.3 → 词权 0.7）
   - `tksim` = 本地 token 重叠分（unigram 0.4 + bigram 0.6），输入 token = `content + title×2 + important_kwd×5 + question_tks×6`（**硬编码元数据加权**）
   - `vtsim` = 二次 KNN-only 回查的干净 cosine（search.py:363-394）
   - `rank_fea` = 标签×10 + pagerank

### 三个关键事实

- **所谓 BM25 不是标准 BM25**（conf/mapping.json）：`scripted_sim` 自定义相似度 `score = query.boost * idf * min(doc.freq, 1)`——饱和 IDF × 词存在性，**官方文档声称用 BM25 与源码不一致**（[文档声称 vs 源码实证]）
- **字段加权硬编码**（query.py:32-40）：`title_tks^10, important_kwd^30, important_tks^20, question_tks^20, content_ltks^2`——元数据字段权重远高于正文
- **Rerank 位置**：召回后、阈值过滤前，候选池固定约 64 条（_rerank_window）；分数不是独立重排而是**替换加权和里的向量分量**（rerank_by_model, search.py:494-519）；模型默认 `BAAI/bge-reranker-v2-m3`（TEI 服务）

### 阈值与引用

- `similarity_threshold` 默认 0.2，融合后过滤（向量权重为 0 时阈值失效）
- 引用：`insert_citations` 对答案逐句再嵌入、与 chunk 算混合相似度（阈值 0.63 起逐级降），命中处插 `[ID:n]`——**事后相似度打分，无白名单**（search.py:251-328）

## 五、权限与版本管理（源码实证）

### 权限

- ES 索引按**租户**（`ragflow_{uid}`），KB 隔离 = 查询时 `kb_id` 过滤项；KB 删除不删索引（同租户共用）
- 访问控制在上层：`KnowledgebaseService.accessible` 校验"本人 or 所在团队"（permission me|team）
- 软删除：`available_int` 查询时过滤；**召回后 `_prune_deleted_chunks` 二次剔除**已删文档残留（"Temporary safety net"）

### 版本管理

- **文档更新 = 全删重插**：`reset_document_for_reparse` 先 delete 全部旧 chunk（含图片）再重新解析+向量化（document_api_service.py:98-151）
- **无向量身份机制**：向量字段按维度命名 `q_{dim}_vec`（仅 512/768/1024/1536 四档），**不含模型名/版本/指令/切块版本**；不同版本同维度向量写进同一字段无防护
- 换 embedding 模型 = 删库重建（[文档声称]）
- chunk id = `xxhash(content_with_weight + doc_id)` 内容寻址幂等

## 六、与 EduCanvas 逐项对比

| 维度         | RAGFlow                                                   | EduCanvas                                                                                             | 谁更强                            |
| :----------- | :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------------- | :-------------------------------- |
| 混合检索融合 | 两级加权和（魔法系数 0.001:1 + 用户权重，各引擎语义不一） | RRF k=60 纯名次融合（knowledge-hybrid-retrieval.ts:41,205-228）                                       | **EduCanvas**：可解释、无分数标定 |
| 向量身份     | **无**（仅维度名 q_{dim}_vec）                            | 五要素 (model, version, instruction, chunkingVersion, hash) + 查询强制等值匹配（schema.ts:2167-2226） | **EduCanvas**                     |
| 降级语义     | fail-soft（空结果重试降阈值）                             | fail-closed：向量超时 1.5s → 降级纯词法并诚实标记 retriever（knowledge-hybrid-retrieval.ts:300-329）  | **EduCanvas**                     |
| 引用         | 事后相似度打分贴 [ID:n]，无白名单                         | 引用白名单 + 快照版本一致性校验（knowledge-retrieval-repository.ts:659-712）                          | **EduCanvas**                     |
| 分块方法     | **15 种模板化分块**（book/laws/paper/manual/qa/table…）   | 无分块器（worker 只接收外部已分好的 chunk）                                                           | **RAGFlow**                       |
| 父子块       | mom_with_weight 冗余字段                                  | 规划中（docs/03-ai/04:85-91）                                                                         | 平手（方向一致）                  |
| 文档解析     | 深度流水线（OCR+布局+TSR+XGBoost）                        | 归 Python 生态，仓库内无实现                                                                          | **RAGFlow**                       |
| Rerank       | 有（候选池 64 条，bge-reranker-v2-m3 默认）               | 未接入生产（候选冻结 Qwen3-Reranker 系列）                                                            | **RAGFlow**（功能层面）           |

## 七、对 KM K 线的启示（可借鉴 3 条）

1. **模板化分块思路（高价值）**：按文档形态预设分块模板（book/laws/paper/manual/qa/table/one）。对应我们的 K 线语料（`docs/` markdown 技术文档）：Markdown 路径的元素化解析（header/fence/list/blockquote）+ 短标题强制合并，正好补我们分块器的缺口。**反引号自定义分隔符绕 token 上限**的设计尤其值得参考（"按结构切" 与 "按 token 切" 双模式）。
2. **LLM 富化参与检索加权（中价值）**：auto_keywords/auto_questions 生成并参与字段加权（important_kwd^30）。我们可评估"产品知识文档的关键词/问题富化"是否值得（注意：RAGFlow 的加权是硬编码魔法系数，我们若做要按 ADR 流程定义可解释的权重）。
3. **位置元数据（中价值）**：页码+bbox 坐标内嵌标签，支撑引用高亮。我们 citation 已有 candidateId/sourceTitle/heading/pageStart/pageEnd（teaching-tools.ts:93-142），页码维度已覆盖，bbox 不需要。

### 明确不借鉴

- 两级加权融合 + 魔法系数（我们有 RRF）
- 无向量身份的裸向量设计（我们有五要素）
- 全删重插的版本管理（我们有先写新后切读）
- 事后相似度引用（我们有白名单）

## 八、一句话总结

> RAGFlow 强在**"文档形态知识固化成分块模板"**（15 种方法 + 深度 PDF 流水线），这正是我们 K 线最薄的分块环节可借鉴的；但它的检索编排（魔法权重、无向量身份、fail-soft、事后引用）比我们的 rrf-v1 + 五要素身份 + fail-closed 低一个严格度档次。**借它的分块模板思想，不借它的检索设计。**
