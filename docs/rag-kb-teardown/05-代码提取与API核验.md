# 05 代码提取与 API 核验

- 状态：`draft`
- 负责人：hzlgou
- 最后验证时间：2026-08-05

## 结论（先看结果）

> **10 个关键 API 中：1 个完全可用（BM25Retriever）、1 个写法正确（SemanticChunker）、1 个完全虚构（BgeRerank）、其余 7 个已弃用或导入路径失效。** 整份技能按 LangChain 0.2/0.3 时代 API 编写，在 2026 年的 LangChain 1.x 环境下 Step 3-6 的代码几乎全部不能直接运行。

## 一、代码块提取（按来源）

### SKILL.md（5 个代码块）

| #   | 位置   | 用途                 | 涉及 API                                                                        |
| --- | ------ | -------------------- | ------------------------------------------------------------------------------- |
| 1   | Step 1 | 一键部署环境         | docker-compose, ollama pull                                                     |
| 2   | Step 3 | 分块（中文推荐配置） | RecursiveCharacterTextSplitter                                                  |
| 3   | Step 4 | 向量化存储           | HuggingFaceEmbeddings, Milvus                                                   |
| 4   | Step 5 | 混合检索 + Rerank    | EnsembleRetriever, BM25Retriever, ContextualCompressionRetriever, **BgeRerank** |
| 5   | Step 6 | 问答链               | RetrievalQA, Ollama                                                             |

**代码块 4（Step 5，混合检索 + Rerank）——含虚构类：**

```python
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever

bm25_retriever = BM25Retriever.from_documents(chunks, k=5)
vector_retriever = vector_store.as_retriever(search_kwargs={"k": 5})

ensemble_retriever = EnsembleRetriever(
    retrievers=[bm25_retriever, vector_retriever],
    weights=[0.3, 0.7]  # 向量权重更高
)

# Rerank 重排（提升准确率）
from langchain.retrievers import ContextualCompressionRetriever
from langchain_community.document_compressors import BgeRerank   # ❌ 此导入必报 ImportError

compressor = BgeRerank(model="BAAI/bge-reranker-large", top_n=3)
```

**代码块 5（Step 6，问答链）：**

```python
from langchain.chains import RetrievalQA          # ❌ LangChain 1.x 已移除
from langchain_community.llms import Ollama        # ⚠️ 已弃用，替代 langchain_ollama.OllamaLLM

llm = Ollama(model="qwen2.5:7b", temperature=0.1)

qa_chain = RetrievalQA.from_chain_type(
    llm=llm, chain_type="stuff", retriever=compression_retriever,
    return_source_documents=True, verbose=True
)
result = qa_chain({"query": "公司的年假政策是什么？"})
```

### references/chunking-strategies.md（5 个代码块）

| #   | 用途         | 涉及 API                                                                               |
| --- | ------------ | -------------------------------------------------------------------------------------- |
| 1   | 固定大小分块 | RecursiveCharacterTextSplitter（chunk_size=512, overlap=50, separators 含 `"。","."`） |
| 2   | 语义分块     | SemanticChunker（langchain_experimental）+ OpenAIEmbeddings                            |
| 3   | 结构化分块   | MarkdownHeaderTextSplitter（headers_to_split_on=[h1,h2,h3]）                           |
| 4   | 小2大        | child 128 tokens / parent 1024 tokens，metadata 记录 `parent_chunk_index`              |
| 5   | 动态重叠     | 纯 Python 函数 `adaptive_overlap`                                                      |

### scripts/setup_rag.py（一键部署脚本逻辑）

| 后端     | 函数                                         | 依赖     | 行为                                          |
| -------- | -------------------------------------------- | -------- | --------------------------------------------- |
| chromadb | `setup_chromadb(persist_dir)`                | chromadb | `PersistentClient(path=...)`                  |
| faiss    | `setup_faiss(index_path, dim=768)`           | faiss    | `IndexFlatIP(dim)`（内积）后 write_index 落盘 |
| milvus   | `setup_milvus(host="localhost", port=19530)` | pymilvus | `connections.connect()` + list_collections    |

argparse 参数：`--backend`（chromadb\|faiss\|milvus，默认 chromadb）、`--persist-dir`、`--index-path`、`--dim`（默认 768）、`--model`（默认 BAAI/bge-large-zh-v1.5）、`--skip-model`。

**局限**：仅做"环境初始化"——没有文档解析、分块、向量写入、检索逻辑；FAISS 分支只建空索引；Milvus 分支硬编码 localhost:19530。且整个文件编译失败（见 [03-代码体检报告](./03-代码体检报告.md)）。

## 二、API 真实性核验表

> 核验方法：官方 reference 站点 + langchain-ai/langchain 与 langchain-community 仓库当前分支源码（gh api 逐字核验）。本环境无 pip/venv，未做运行时导入实测。

| #   | 技能中的 API                                             | 存在性                       | 状态 / 推荐替代                                                                                                                                                                                                                                                                                                                                                                             | 证据来源                                                                                                                                               |
| --- | -------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `langchain.text_splitter.RecursiveCharacterTextSplitter` | 类真实，**导入路径失效**     | 真实位置 `langchain_text_splitters.RecursiveCharacterTextSplitter`（独立包）。`langchain.text_splitter` 自 0.1.0 弃用，**LangChain 1.x 主包已删除该模块**                                                                                                                                                                                                                                   | [langchain_text_splitters 参考](https://reference.langchain.com/python/langchain_text_splitters/)                                                      |
| 2   | `langchain_experimental.text_splitter.SemanticChunker`   | ✅ **存在，写法正确**        | `breakpoint_threshold_type` 合法值：percentile（默认）/standard_deviation/interquartile/gradient；实验性质，API 可能变动                                                                                                                                                                                                                                                                    | [langchain-experimental](https://github.com/langchain-ai/langchain/commit/a4896da2a0264c3405b5a97d03fff673ddee8402)                                    |
| 3   | `langchain.text_splitter.MarkdownHeaderTextSplitter`     | 类真实，**导入路径失效**     | 真实位置 `langchain_text_splitters.MarkdownHeaderTextSplitter`，`headers_to_split_on` 参数正确                                                                                                                                                                                                                                                                                              | [langchain_text_splitters 参考](https://reference.langchain.com/python/langchain_text_splitters/)                                                      |
| 4   | `langchain_community.embeddings.HuggingFaceEmbeddings`   | 存在但**已弃用**             | `@deprecated(since="0.2.2", removal="1.0", alternative_import="langchain_huggingface.HuggingFaceEmbeddings")`                                                                                                                                                                                                                                                                               | [源码 huggingface.py](https://github.com/langchain-ai/langchain-community/blob/main/libs/community/langchain_community/embeddings/huggingface.py)      |
| 5   | `langchain_community.vectorstores.Milvus`                | 存在但**已弃用**             | 替代 `langchain_milvus.MilvusVectorStore`；源码注释 "DO NOT USE. KEPT FOR BACKWARDS COMPATIBILITY"                                                                                                                                                                                                                                                                                          | [源码 vectorstores/milvus.py](https://github.com/langchain-ai/langchain-community/blob/main/libs/community/langchain_community/vectorstores/milvus.py) |
| 6   | `langchain.retrievers.EnsembleRetriever`（weights）      | 存在但 **1.x 已移出主包**    | 迁移到 `langchain_classic.retrievers.EnsembleRetriever` 或 `create_retrieval_chain`；weights 参数真实，默认融合为 RRF                                                                                                                                                                                                                                                                       | [langchain-classic 参考](https://reference.langchain.com/python/langchain-classic/retrievers/)                                                         |
| 7   | `langchain_community.retrievers.BM25Retriever`           | ✅ **存在，未弃用**          | `k: int = 4`，`from_documents` 齐全，无 deprecation 装饰器。**技能里少数完全可用的 API**                                                                                                                                                                                                                                                                                                    | [源码 retrievers/bm25.py](https://github.com/langchain-ai/langchain-community/blob/main/libs/community/langchain_community/retrievers/bm25.py)         |
| 8   | `ContextualCompressionRetriever` + **`BgeRerank`**       | 前者移出主包；**后者不存在** | **`BgeRerank` 在任何版本、任何包中都不存在**：document_compressors 目录无 bge_rerank.py，`__all__` 仅含 8 个类（LLMLinguaCompressor、OpenVINOReranker、FlashrankRerank、JinaRerank、RankLLMRerank、DashScopeRerank、VolcengineRerank、InfinityRerank）。BGE reranker 正确用法：`CrossEncoderReranker` + `HuggingFaceCrossEncoder(model_name="BAAI/bge-reranker-large")` 或 `InfinityRerank` | [document_compressors 目录](https://github.com/langchain-ai/langchain-community/tree/main/libs/community/langchain_community/document_compressors)     |
| 9   | `langchain.chains.RetrievalQA`                           | **已移除/弃用**              | LangChain 1.0 将 chains 整体移入 `langchain-classic`，`from langchain.chains import RetrievalQA` 直接 ImportError；官方替代 LCEL `create_retrieval_chain` + `create_stuff_documents_chain`                                                                                                                                                                                                  | [LangChain v1 迁移指南](https://docs.langchain.com/oss/python/migrate/langchain-v1)                                                                    |
| 10  | `langchain_community.llms.Ollama`                        | 存在但**已弃用**             | 替代 `langchain_ollama.OllamaLLM`（model + base_url 或 OLLAMA_BASE_URL）                                                                                                                                                                                                                                                                                                                    | [源码 llms/ollama.py](https://github.com/langchain-ai/langchain-community/blob/main/libs/community/langchain_community/llms/ollama.py)                 |

## 三、重点结论

1. **`BgeRerank` 是纯虚构类**——核验路径：GitHub API 直接列出 document_compressors 目录（8 个模块文件，无 bge_rerank），逐字读取 `__init__.py` 的 `__all__`（无 BgeRerank）。技能 Step 5 的 Rerank 代码运行到此处必抛 ImportError。
2. **`RetrievalQA` 已从 `langchain.chains` 移除**——LangChain 1.0（2025-10）将 chains/retrievers/memory/indexes/hub 全部移入 `langchain-classic`；1.x 主包只剩 agents/chat_models/embeddings/messages/rate_limiters/tools。
3. **整体判断**：技能代码是 0.2/0.3 时代（2024 年）API 的翻新版本，混入至少一个虚构类，未做过任何一次真实运行。

## 四、对 EduCanvas 的启示（预览，详见 07 篇）

- EduCanvas 不依赖 LangChain（CLAUDE.md 硬约束），本表的"弃用/失效"问题对 EduCanvas 不直接构成风险；
- 真正有价值的是**思想**而非代码：混合检索编排（BM25+向量+RRF 已在 EduCanvas 实现为 `rrf-v1`）、SemanticChunker 的语义断点思路、小2大检索、评估指标体系。
