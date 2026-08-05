# 09 LlamaIndex 父子分块对标

- 状态：`draft`
- 负责人：hzlgou
- 最后验证时间：2026-08-05

> 基于 LlamaIndex 官方仓库源码分析（commit `5c0e64e`，main，本地浅克隆），结论全部标注 **[源码实证]**（clone 内直接读到）或 **[文档声称]**（官方 notebook/文档）。对标对象：EduCanvas KM 计划 K 线规划中的"父子块"方案（docs/03-ai/04-检索增强与嵌入.md:85-91：保留年级/章节/知识点）。

## 一、两个核心组件

| 组件                   | 位置                                                                                    | 职责                                  |
| :--------------------- | :-------------------------------------------------------------------------------------- | :------------------------------------ |
| HierarchicalNodeParser | `llama-index-core/llama_index/core/node_parser/relational/hierarchical.py`（约 235 行） | 把文档按多级 chunk 尺寸切出层级节点树 |
| AutoMergingRetriever   | `llama-index-core/llama_index/core/retrievers/auto_merging_retriever.py`（约 194 行）   | 检索时把命中叶子按阈值合并回父节点    |

## 二、HierarchicalNodeParser 切分原理（源码实证）

### 层级切分

- `chunk_sizes` 按层级顺序，**第 0 层最大（根）、最后一层最小（叶）**，默认 `[2048, 512, 128]`（hierarchical.py:127）
- 每层独立构造 `SentenceSplitter`（hierarchical.py:132-138），共享 `chunk_overlap=20`（hierarchical.py:116，注意 SentenceSplitter 自身默认 200，此处被覆盖成 20）
- 自上而下逐层全量切：先把上层所有节点切完再递归下一层（hierarchical.py:196-205）
- 返回**扁平列表按层级排序**（先全部根、再中间、最后叶，层内保持文档顺序）

### 父子关系记录（hierarchical.py:14-22）

```python
# 子节点挂 PARENT（单个 RelatedNodeInfo）
child.relationships[NodeRelationship.PARENT] = parent.as_related_node_info()
# 父节点挂 CHILD（列表）
parent.relationships[NodeRelationship.CHILD] = child_list
```

- 关系存在节点对象的 `relationships` dict 里（schema.py:302-308），**不是单独的表**
- `RelatedNodeInfo` 只含 4 字段：node_id、node_type、metadata、hash（schema.py:249-257），不存全文
- 只在 level > 0 时加关系（hierarchical.py:186）——根节点（2048 级）不挂 PARENT

### 节点角色定义

- 叶节点 = 无 CHILD 关系（`get_leaf_nodes`，不是"最深一层"概念）
- 根节点 = 无 PARENT 关系
- 中间节点 = 同时有 PARENT 和 CHILD

## 三、AutoMergingRetriever 检索流程（源码实证）

```
_retrieve: initial = vector_retriever.retrieve(query)   # 官方示例：只向量化叶节点
           while is_changed: cur, is_changed = _try_merging(cur)   # 循环直到无变化
           sort by score desc
```

### 合并条件（auto_merging_retriever.py:56-125）

- 对每个命中节点，若有 parent_node 关系，从 docstore 取真实父节点
- 每个父节点聚合命中的子节点，算 `ratio = 命中子节点数 / 父节点全部子节点数`
- **`ratio > simple_ratio_thresh`（严格大于，默认 0.5）才合并**（auto_merging_retriever.py:90）

| 父节点孩子总数 | 需要命中几个才合并           |
| :------------- | :--------------------------- |
| 2              | 2（2/2=1.0，1/2=0.5 不触发） |
| 3              | 2（2/3≈0.67）                |
| 4              | 3（3/4=0.75）                |

### 合并动作

- 删除命中的子节点，加入父节点；**父节点分数 = 子节点平均分**（:110-116）
- 父节点**全文**从 docstore 取出（:71-74）——含查询无关的兄弟内容
- 循环迭代使合并后的父节点可继续向上一层合并（最多 = 层级数）

### 补洞 `_fill_in_nodes`（:127-164）

- 若连续两个命中节点在文档中相邻（`cur.next_node == nodes[i+1].node.prev_node`），从 docstore 取中间缺失节点补入，分数取均值
- **触发条件苛刻**：依赖按分数排序后列表的相邻性

## 四、存储设计（源码实证）

- **父子关系随节点 JSON 序列化进 docstore**（KV 存储），不进向量库
- **向量库只存叶子节点**（官方示例）；父/中间节点只在 docstore，合并时按 id 随机回查
- 命中节点从向量库读出时靠 `metadata["_node_content"]`（完整节点 JSON）还原 parent 信息——**外部向量库若不存全量 metadata，合并会静默失效**（社区报告，[StackOverflow #77719901](https://stackoverflow.com/questions/77719901)）
- 叶子 `ref_doc_id` 被设为其二级父节点 id——维护者确认是有意设计（[Discussion #8430](https://github.com/run-llama/llama_index/discussions/8430)），副作用是 ResponseSynthesizer 默认 compact 模式会把同父叶子合入尽量少的 LLM 调用

## 五、参数默认值（源码实证）

| 参数                  | 默认值             | 位置                         |
| :-------------------- | :----------------- | :--------------------------- |
| `chunk_sizes`         | `[2048, 512, 128]` | hierarchical.py:127          |
| `chunk_overlap`       | `20`               | hierarchical.py:116          |
| `simple_ratio_thresh` | `0.5`（严格大于）  | auto_merging_retriever.py:39 |
| `similarity_top_k`    | 官方示例 6         | 文档声称                     |
| `verbose`             | False              | 源码实证                     |

⚠️ **纠正教程谣言**：网上流传的 `threshold=2`（int 参数）、`chunk_overlap` 被移除等说法与源码矛盾（v0.9.48 与 main 双版本核对）——以源码为准。

## 六、效果评估（诚实标注）

- **官方自评**：60 题 GPT-4 评测，auto-merging vs 基础 retriever 正确性 4.267 vs 4.208，结论原文 **"The results are roughly the same."**（[文档声称]）——官方没有证明质量提升
- **第三方**（DeepLearning.AI 课程）：3 层（128/512/2048）比 2 层（512/2048）上下文相关性高约 20%、成本约减半（[文档声称]）
- **已知 bug**：[#10699](https://github.com/run-llama/llama_index/discussions/10699) 自定义子类多层级混喂时 `_fill_in_nodes` 无限补洞死循环（无官方修复）；[#19251](https://github.com/run-llama/llama_index/issues/19251) HTML/Docling 类层级几乎全被拍平，AutoMergingRetriever 作用受限

## 七、与 EduCanvas 规划中"父子块"的对比

| 维度         | LlamaIndex                                           | EduCanvas 规划（docs/03-ai/04:85-91）                            | 对比                                                                                |
| :----------- | :--------------------------------------------------- | :--------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| 父子关系存储 | 节点 relationships dict（随 JSON 序列化）            | 未定（我们 schema 的 knowledge_chunks 是单表，heading 列已存在） | 我们的单表 + heading 更简单；LlamaIndex 的"父存 docstore、子进向量库"分离设计可参考 |
| 合并触发     | 比例制（命中兄弟/总兄弟 > 0.5）                      | 未定                                                             | 比例制合理（避免一个命中就拉全父块），但 0.5 需自测                                 |
| 父块内容     | 父节点全文（含无关兄弟）                             | 未定                                                             | **注意膨胀问题**：父块全文进上下文是 LlamaIndex 的已知弱点                          |
| 元数据       | RelatedNodeInfo 四字段（node_id/type/metadata/hash） | 我们已有 chunk 内容哈希 + 切块版本                               | 我们更强：身份五要素天然支持父子切换                                                |
| 切块版本     | 无显式机制                                           | `chunkingVersion`（schema.ts:2181）                              | 我们更强                                                                            |
| 效果证明     | 官方自评"roughly the same"                           | 未评测                                                           | 都需自测，不能想当然                                                                |

## 八、对 KM K 线的启示（可借鉴 3 条）

1. **"子块进向量、父块按需回查"的存储分离（高价值）**：向量库只存叶子，父节点按 id 回查——与我们"向量按身份共存"的设计兼容，实现简单（不需要建父块表，冗余字段或回查二选一；RAGFlow 用的是 mom_with_weight 冗余字段，LlamaIndex 用 docstore 回查——两个方案都可以对标）。
2. **比例制合并阈值（中价值）**：`ratio > 0.5` 的严格大于语义清晰，但需注意二分父节点必须全命中才合并的保守性；我们落地时阈值要按自己的评测集定，不照抄 0.5。
3. **补洞机制的反面教材（低价值）**：`_fill_in_nodes` 触发条件苛刻且有死循环 bug（#10699）——我们要做就做"按文档顺序补全同父兄弟"的显式逻辑，不做依赖排序后相邻性的隐式补洞。

### 明确不借鉴

- 父节点全文进上下文（上下文膨胀是已知弱点）
- 依赖 metadata 还原父子关系的机制（外部向量库静默失效风险）
- 官方评测未证明增益——落地前必须用我们的冻结评测集验证

## 九、一句话总结

> LlamaIndex 的父子分块**设计可参考（层级切分 + 比例合并 + 存储分离）**，但官方自评"roughly the same"、父块全文膨胀、metadata 依赖静默失效——**收益未被证明，实现有坑**。我们做父子块时要：参考它的层级结构与合并思路，但用我们更强的身份机制（chunkingVersion）管好版本，用自有评测集验证收益，避免父块全文直接进上下文。
