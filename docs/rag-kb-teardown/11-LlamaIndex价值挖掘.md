# 11 LlamaIndex 价值挖掘：可用部分与使用方式

- 状态：`draft`
- 负责人：hzlgou
- 最后验证时间：2026-08-05

> 结论先行：**LlamaIndex 整体不可引入**（core 包 30 个运行时依赖 + 框架耦合），但它内部有**两块极轻的纯逻辑可抽取**：`MarkdownNodeParser`（60 行标题分块，输出 header_path）+ `SentenceSplitter` 合并逻辑（~180 行，句子偏好）。两者正好补 deepdoc 不做 Markdown 的缺口。检索侧：我们的 rrf-v1 与它的 RRF 同公式且工程更强，借鉴点是"多查询×多路融合"与"检索后处理"两个思想。

## 零、整体判断

| 判断                   | 依据                                                                                                                                       |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| 框架不可引入           | core 30 个运行时依赖（SQLAlchemy/aiohttp/networkx/banks/llama-index-workflows…，pyproject.toml:57-87），与 Next.js/Postgres 栈混装风险面大 |
| **分块器可抽**         | MarkdownNodeParser 零第三方依赖（纯 re，file/markdown.py:48-107）；SentenceSplitter 算法本体 ~180 行（text/sentence.py:179-345）           |
| **检索器思想可借鉴**   | RRF 公式与 rrf-v1 同构（k=60、1/(rank+k)），工程上我们更强；借鉴点是它多出来的结构                                                         |
| 解析侧不能替代 deepdoc | 默认 PDFReader 用 pypdf 纯文本层，无 OCR/布局/TSR（能力代差）                                                                              |

## 一、✅ 可抽取：MarkdownNodeParser（标题分块，最高价值）

**位置**：`llama-index-core/llama_index/core/node_parser/file/markdown.py:14-107`（注意：在 `file/` 不在 `text/`）

**算法（源码实证）**：

- 纯行扫描 + `re.match(r"^(#+)\s(.*)")`，只认行首无缩进标题（:67）
- 栈维护标题路径：`while header_stack and header_stack[-1][0] >= header_level: pop`（:87）——H1→H3 跳级正确归位
- 代码块保护：` ``` ` 行 toggle，块内不解析标题（:60-63）
- 输出 node 文本**包含自己的标题行**（:92）

**关键产出——`header_path` 元数据**（:118-123，已实测坐实）：

```
node.metadata["header_path"] = "/h1/h2/"   # 父标题路径，不含自身
```

**这正是我们 docs/ 语料需要的"章节归属"**——检索命中后能知道 chunk 属于哪个章节层级。

**⚠️ 关键局限（源码实证）**：**完全没有 chunk_size/overlap 概念**——按标题切完即止，一个超长 section 会产出巨大 node。必须与大小合并组合。

**依赖面**：算法核心零第三方依赖（仅 stdlib `re`）；外围 pydantic/tqdm/callback 都是可裁掉的壳。依赖闭包 12 个 core 文件（无 indices/storage/llms/embeddings 耦合）。

## 二、✅ 可抽取：SentenceSplitter 合并逻辑（句子偏好 + overlap）

**位置**：`llama-index-core/llama_index/core/node_parser/text/sentence.py:179-345`

**算法（源码实证）**：

- 切分顺序：段落 `\n\n\n` → nltk 句子 tokenizer → 兜底 regex `"[^,.;。？！]+[,.;。？！]?|[,.;。？！]"`（:23，**已含中文句读**）→ 空格 → 单字符
- 合并：贪心填充，`cur + split <= chunk_size` 继续加（:281）
- **句子偏好**（:296-299）：完整句子即使会超 chunk_size 也强行塞入当前 chunk——这是它比 TokenTextSplitter"少悬挂句"的根本原因
- overlap：从上一 chunk 尾部向前取，条件 `cur + last <= chunk_overlap(200)`（:264-274）
- 默认 chunk_size=1024 / overlap=200（SENTENCE_CHUNK_OVERLAP，:22,49）

**⚠️ 依赖（可替换）**：nltk punkt（英文训练，中文语料下基本退化为自带中文 regex）+ tiktoken（`get_tokenizer` 可注入替换，utils.py:144-182）。**构造参数支持自定义 tokenizer 和 chunking_tokenizer_fn**（sentence.py:73-76）——剥离 nltk/tiktoken 后算法可独立运行（源码直接支持的扩展点）。

**抽取成本**：合并逻辑约 180 行纯字符串 + tokenizer 回调注入。

## 三、✅ 组合方案：按标题切节 → 节内句子合并（我们该怎么用）

两个 parser 天然互补（一个按结构切、一个按大小合并），组合起来正好是我们的分块器方案：

```
MarkdownNodeParser（按标题切节，带 header_path）
  → 每个 section 是标题 + 正文
  → SentenceSplitter 逻辑（替换 tokenizer 为我们模型口径）在节内按 chunk_size 合并
  → 输出：chunk + header_path 元数据（可映射到我们 schema 的 heading 列）
```

**与 RAGFlow naive_merge 的分工**（两者已评估，见 [10](./10-RAGFlow价值挖掘.md)）：

- **Markdown 语料**（docs/ 产品文档）→ LlamaIndex 组合方案（标题层级 + header_path 是刚需）
- **PDF/扫描件/表格** → deepdoc（深度解析）
- **naive_merge**（delimiter + token 合并）→ 可作为节内合并的另一候选，与 SentenceSplitter 各测一轮中文分块质量再定

**对比 naive_merge 的增量价值**：SentenceSplitter 的"句子偏好 + overlap 合并"（不悬挂句）是相对 RAGFlow 纯文本合并的改进。

## 四、✅ 思想借鉴：检索侧（不抽代码，看设计）

### 4.1 RRF 公式同构——我们的 rrf-v1 工程更强（对照表）

| 维度     | LlamaIndex RRF（fusion_retriever.py:113-148）   | EduCanvas rrf-v1                   |
| :------- | :---------------------------------------------- | :--------------------------------- |
| 公式     | `1.0/(rank + 60)`（:122,135，k 硬编码）         | 同公式，归一化 [0,1]（khr.ts:214） |
| 去重键   | 内容哈希 node.hash（不同 chunk 同文本会误合并） | DB 主键 chunkId                    |
| 失败处理 | **无 try/except**，任一检索器报错整体失败       | 向量超时 1.5s 降级 FTS + 诚实标注  |
| 权重     | RRF 模式忽略权重                                | 等权（显式排斥线性加权）           |
| 可重放   | 无状态                                          | queryHash + 候选账本               |
| 默认模式 | 其实是 SIMPLE 不是 RRF（:39）                   | 直接 RRF                           |

**结论：不要回抄 LlamaIndex 的 RRF 工程细节，我们的更强。**

### 4.2 值得借鉴的两个结构（高价值）

**1. 多查询×多路融合（query expansion + RRF）**（fusion_retriever.py:83-94, 276-284）：

- LlamaIndex 默认 `num_queries=4`——LLM 生成 3 个扩展查询，每个查询 × 每个检索器全组合检索后一起 RRF 融合
- **扩展查询的名次多样性对 RRF 是免费收益**（RRF 只吃名次）
- ⚠️ 落地冲突（需 Code Owner 拍板）：queryHash 账本语义要扩展、向量 ANN 扫描次数增加（1.5s 预算需重算）、LLM 非确定性 vs 可重放哲学——建议作为显式版本化的 **rrf-v2** 评估，扩展查询名次才允许进融合

**2. 检索后处理两步**（auto_merging_retriever.py）：

- **块补洞**（:127-164）：命中块 i 和 i+1 而中间块未命中时补入，分数取相邻均值——解决"语义检索把连续段落劈开"的常见失败模式。我们 RankedChunk 自带 chunkIndex/documentId（khr.ts:72-77），**连续性判断零成本**
- **父级合并**（:56-125）：某父节点 >50% 子块命中（simple_ratio_thresh=0.5）时删子块换父块，分数取均值——教材场景价值中等，建议加 max parent tokens 上限控制

### 4.3 不借鉴（含理由）

- **LLM 路由**（RouterRetriever）：我们有确定性等价物（`vectorRequested = queryEmbedding && identity` 门控，khr.ts:269-276）；LLM 路由引入非确定性 + 额外调用
- **HyDE**：假想文档向量是另一个分布，与向量身份五要素冲突；且每次查询多一次 LLM + embedding（1.5s 预算吃紧）
- **RecursiveRetriever**：我们有 `turn_source_versions` 冻结作用域解决"索引指向哪个语料"，IndexNode 图只加间接层和环风险

## 五、✅ 解析侧补充价值（不替代 deepdoc）

| 能力                                        | 结论                                                                                                                                                |
| :------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯文本型 PDF 轻量提取                       | pypdf 单依赖无模型（readers-file/docs/base.py:53-91），数字原生 PDF 秒出文本——deepdoc 对这类是杀鸡用牛刀                                            |
| Markdown 结构处理                           | MarkdownNodeParser（上文 §一）是唯一真价值；deepdoc 不做 Markdown                                                                                   |
| SimpleDirectoryReader                       | 多格式目录批量摄取 + 文件元数据自动注入（core/readers/file/base.py:148-184）——概念可参考                                                            |
| LlamaParse                                  | ❌ 已弃用（2026-03 起迁移 llama-cloud v2，早于此前调研说的 2026-05）；云端服务不适用自托管                                                          |
| MarkdownReader（注意是 reader 不是 parser） | ⚠️ **有 bug**：remove_images 正则 `r"![(.?)](.?)"` 匹配不了标准 `![alt](url)`（markdown/base.py:105，已实测）——不要用，用 MarkdownNodeParser 或自研 |

## 六、抽取成本与策略（实测依赖闭包）

| 组件                      | 闭包规模                                                | 外部依赖                                                                                                            | 策略                                                                         |
| :------------------------ | :------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------- |
| MarkdownNodeParser        | 12 个 core 文件                                         | 零（纯 re）                                                                                                         | **(a) ast 抽取 ~60 行**                                                      |
| SentenceSplitter 合并逻辑 | 14 个 core 文件                                         | pydantic/dataclasses-json/deprecated/requests/filetype/pillow/platformdirs/typing-extensions + 懒加载 nltk/tiktoken | **(a) ast 抽取 ~180 行**（替换 tokenizer 省掉 nltk+tiktoken）                |
| FusionRetriever           | **222 个文件**（retrievers/**init** 拖全包）            | SQLAlchemy/numpy/fsspec…                                                                                            | ❌ 不整体抽；融合算法本体 ~120 行纯函数（fusion_retriever.py:113-230）可单抽 |
| AutoMergingRetriever      | **152 个文件**（VectorIndexRetriever + StorageContext） | 同上                                                                                                                | ❌ 不整体抽；补洞/合并算法本体（:56-164）可参考重写                          |

**三种策略对比**（实测）：

- (a) **ast 抽取**（naive_merge 式）：300-400 行即可跑，成本最低，与我们已验证的 RAGFlow 抽取路线一致
- (b) pip 装 llama-index-core：**成本最高**——30 个声明依赖全落地（含 core 源码 0 处 import 却声明为运行时依赖的 llama-index-workflows，pyproject.toml:83）
- (c) 参考重写：介于两者之间，MIT 许可（pyproject.toml:42）允许

## 七、行动建议（按优先级）

| 优先级 | 事项                                                                                                                            | 前置                 |
| :----- | :------------------------------------------------------------------------------------------------------------------------------ | :------------------- |
| P0     | 用 ast 抽取 MarkdownNodeParser（~60 行）+ SentenceSplitter 合并逻辑（~180 行，注入我们 tokenizer），实测中文 docs/ 语料分块质量 | 无（本地源码已就绪） |
| P0     | 与 RAGFlow naive_merge 各跑一轮中文分块质量对比，决定节内合并用哪个                                                             | 上一条               |
| P1     | 检索后处理（块补洞）设计：RankedChunk 连续性判断零成本，作为不改变检索语义的后处理                                              | rrf-v1 现状确认      |
| P2     | rrf-v2 评估：多查询×多路融合（query expansion + RRF），含账本语义扩展方案                                                       | Code Owner 拍板      |

## 八、P0 实测结论：MarkdownNodeParser 中文分块质量（2026-08-05 追加）

> 验证方法：行级原样切片提取 `get_nodes_from_node`（`file/markdown.py:50-107`，保留原始缩进，`_build_node_from_split` 替换为 `(text, header_path)` 元组函数），torch_sm120 环境（Python 3.11）实跑。与 [10](./10-RAGFlow价值挖掘.md) §七 的 naive_merge 模块同环境、可复现。

### 实测结果

| 测试项                                      | 结果                                                                                                    |
| :------------------------------------------ | :------------------------------------------------------------------------------------------------------ |
| 提取成功                                    | ✅ 方法体原样切片，仅替换 pydantic 外壳（_mk 元组函数）                                                 |
| 真实文档切分                                | ✅ 文档维护规则.md（1515 字符）→ 7 个 section，header_path 全部正确（顶层 `''`、二级 `'文档维护规则'`） |
| 代码块保护                                  | ✅ 代码块内 `# 注释` 未被当标题（` ``` ` 行 toggle）                                                    |
| H1→H3 跳级归位                              | ✅ `顶级/二级/三级` → `顶级` → `''`，标题栈 pop 逻辑正确                                                |
| 长 section 问题                             | ⚠️ **确认**：2000 字符长 section 保持原样（无 chunk_size 切分），必须与合并器组合                       |
| 组合方案（标题切节 + naive_merge 节内合并） | ✅ 7 个 section → 14 个 chunk（128 tokens），全部在预算内                                               |

### 落地注意点（实测发现）

1. **header_path 传播**：naive_merge 会把标题行 `# 长章节` 合并进第一个子 chunk 的正文（实测确认），但 header_path 元数据来自 MarkdownNodeParser——**组合后必须把 section 的 header_path 传播到每个子 chunk**（映射到我们 schema 的 heading 列）
2. **tokenizer 口径**：本节测试用 cl100k_base（naive_merge 自带），落地时替换为我们模型 tokenizer（与 [10](./10-RAGFlow价值挖掘.md) §七 适配点 3 一致）
3. **提取方式修正**：ast.unparse 重建会破坏嵌套缩进（实测踩坑），**改用行级切片 + 最小替换**更稳——验证脚本保留在会话临时目录

### P0 完成 → 行动清单更新

- ✅ P0 MarkdownNodeParser 抽取与中文分块质量实测（本节）
- ⬜ P0 与 RAGFlow naive_merge 各跑一轮中文分块质量对比，决定节内合并用哪个（下一步）

## 九、一句话总结

> LlamaIndex 与 RAGFlow 正好互补：**RAGFlow 给 deepdoc（PDF 深度解析），LlamaIndex 给 MarkdownNodeParser（标题分块 + header_path）**——合起来就是 K 线分块器的完整拼图。检索侧我们的 rrf-v1 与它同公式且更强，只借两个思想：多查询×多路融合（rrf-v2 候选）和块补洞（后处理）。抽取方式与 RAGFlow 一致：取纯逻辑，不引框架。
