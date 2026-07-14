# 掌握度模型与误区标注规格

- 状态：`accepted`
- 相关决策：[ADR-0005](../09-decisions/0005-mastery-modeling.md)
- 本文档是实现依据；所有数值参数为初始默认值，放配置，待评测集校准。

## 掌握度公式（v1）

输入（均来自 `mastery_states` 与知识图谱）：

```text
m_prev  = 当前 mastery_score
a, c, h = attempt_count, correct_count, hint_count
u       = 活跃（active）误区标签数量
days    = 距 last_practiced_at 的天数
prereqs = 各先修节点的 mastery_score
```

计算：

```text
recency_decay        = exp(-0.035 * days)
m_recency            = m_prev * recency_decay

success_rate         = (c + 1) / (a + 2)                  # Beta(1,1) 平滑，冷启动=0.5
hint_factor          = max(0.70, 1 - 0.15 * h / max(a,1))
misconception_factor = max(0.70, 1 - 0.05 * u)

prereq_cap = 无先修 ? 1.0 : min(1.0, 0.85 + 0.15 * min(prereqs))

evidence   = success_rate * hint_factor * misconception_factor
m_new      = clamp(0.35 * m_recency + 0.65 * evidence, 0, prereq_cap)
```

各因子的语义（这也是向教师和家长解释的口径）：

- **success_rate**：平滑后的独立答对比例，冷启动从 0.5 开始而不是从不稳定的极端值开始；
- **hint_factor**：频繁求助降低"独立掌握"的置信度，下限 0.70 防止一票否决；
- **misconception_factor**：活跃概念错误压低分数，误区被解决后惩罚消失；
- **recency 项**：遗忘衰减，长期不练分数缓慢回落；
- **prereq_cap**：先修不牢时下游分数封顶，防止"地基没打好但楼看起来很高"。

事件到计数的映射：测评答对 → `a+1, c+1`；答错 → `a+1`；请求提示 → `h+1`；误区标注由 `updateMisconception` 工具写入标签对象。互动实验和动画步骤事件 v1 不进公式，只作过程记录（开放问题 1）。

## ASSESS 出口决策（填 ADR-0004 的 guard）

```text
θ_enter = 0.85    # 进入掌握
θ_exit  = 0.75    # 跌出掌握（滞后区间防震荡）
prereq_gate = 0.80
近期测评窗口：≥ 3 题且正确率 ≥ 80%

已掌握状态下：
  score < θ_exit 或存在活跃严重误区 → REMEDIATE
  否则维持 ADVANCE

未掌握状态下：
  score ≥ θ_enter 且先修全部 ≥ prereq_gate
    且近期测评窗口达标 且无活跃严重误区 → ADVANCE
  否则 → REMEDIATE
```

- 滞后区间的作用：单次失误不会把学生从 ADVANCE 拉回 REMEDIATE，必须累积足够反证；
- **严重误区清单与课程绑定**，放课程配置（示例：猫狗课中 `TRAINS_DURING_USE`、`MEMORIZATION_EQUALS_GENERALIZATION` 为严重）；
- 不按学段设置不同 θ：证据支持"高标准"本身，不支持年龄化数值；学段差异体现在最少证据量和补救风格上。

## 下一知识点推荐

双队列 + 确定性优先级：

1. **复习队列**：`next_review_at` 已到期的节点，按逾期天数排序；
2. **新学队列**：未掌握且先修全部 ≥ `prereq_gate` 的节点（ready-to-learn），按 `0.5 * 先修裕度 + 0.3 * 课程路径权重 - 0.2 * |score - 0.6|` 排序（最后一项偏好"不太易也不太难"）；
3. 优先级：先修节点出现活跃误区 → 补救最优先；复习逾期 ≥ 2 天且分数已跌破 `θ_exit` → 复习优先；否则新学优先；
4. 新学队列为空时，推荐最弱的先修阻塞节点。

## 复习调度（与掌握度分离）

v1 用确定性分层调度器写 `next_review_at`，后续可整体替换为 FSRS 而不影响其他部分：

```text
score < 0.45 → 1 天    0.45–0.65 → 3 天    0.65–0.80 → 7 天
0.80–0.90   → 14 天    ≥ 0.90 → 30 天
活跃误区 ≥ 2 个时间隔减半（下限 1 天）
```

调度器只决定"何时复习"，永不决定"是否掌握"。

## 误区标签体系（v1 封闭核心集）

| 组 | 标签 | 含义 |
|---|---|---|
| AI 系统本质 | `ANTHROPOMORPHISM` | 拟人化（AI"想""喜欢""知道"） |
| | `PROGRAMMED_BEHAVIOR_ONLY` | 认为 AI 行为全部由人逐条编程 |
| | `AI_IS_EXACT_OR_CERTAIN` | 认为 AI 输出精确无误、非概率 |
| ML 流程误解 | `TRAINS_DURING_USE` | 认为模型在使用时持续训练 |
| | `USER_TRAINS_MODEL_NOW` | 认为自己此刻的使用在训练模型 |
| | `STORES_RAW_EXAMPLES` | 认为模型存储并检索原始样本 |
| | `AUTONOMOUS_DATA_ACQUISITION` | 认为模型自己出去找数据 |
| | `CONFUSES_MODEL_WITH_DATA` | 混淆模型与训练数据 |
| 学习与评价误解 | `FEATURE_IS_SINGLE_OBVIOUS_TRAIT` | 认为分类只看一个显眼特征 |
| | `MEMORIZATION_EQUALS_GENERALIZATION` | 把记住样本当成学会泛化 |
| | `MORE_DATA_ALWAYS_FIXES_ERRORS` | 认为加数据必然消除错误 |
| | `CORRELATION_EQUALS_REASON` | 把相关当因果/理由 |
| | `ONE_METRIC_IS_ENOUGH` | 认为一个指标足以评价模型 |

标签生命周期：`misconception_tags` 存对象 `{ tag, status: active | resolved, first_seen_at, last_seen_at }`。REMEDIATE 完成且针对性测评通过 → `resolved`；同一标签再次出现 → 重新 `active` 并更新 `last_seen_at`。只有 `active` 标签进入公式与 guard。

## 误区标注工具契约（`updateMisconception` 的上游）

LLM 标注器的输出必须满足，否则整体拒绝：

```text
{
  "labels": [核心标签子集 | "NONE"],
  "evidence_quotes": [{ "label", "quote" }],   # quote 必须逐字出现在学生回答中，服务端校验
  "rationale": "...",
  "confidence": 0.0-1.0,
  "abstain": true|false,
  "candidate_new_label": { "name", "definition" } | null
}
```

- 每个非 NONE 标签必须有证据引用，服务端做逐字匹配校验，不匹配即整体拒绝；
- 证据不足必须弃权（NONE + abstain），弃权不产生任何状态变化；
- `CANDIDATE_NEW_LABEL` 只入提案库，人工评审后才可能进入核心集，**永不直接驱动状态机**；
- 标注器永不输出掌握度分数。

## 误区 → 补救策略映射

REMEDIATE 时由状态机按误区类型选择补救形式（对应 Canvas Artifact）：

| 误区类型 | 策略 | Canvas 形式 |
|---|---|---|
| ML 流程误解 | 针对性重讲流程结构 | `pipeline_flow` 动画对比"训练时/使用时" |
| 精确性/确定性误解 | 反例 + 认知冲突（需即时脚手架） | 两张相近图片产生不同置信度的演示 |
| 仅编程行为误解 | 认知桥接：规则程序 vs 学习模型并排对比 | `comparison_morph` / 分类游戏两种模式 |
| 拟人化 | 驳斥式对比人类能力与机器能力 | `concept_card` 驳斥文本 |
| 泛化/特征误解 | 工作样例对比（训练样本/表面特征陷阱/真迁移） | `classification_game` 定制题组 |

## 开放问题

1. 终身计数问题：早期失败会长期压低 success_rate。v1 接受"终身计数 + recency 混合"；备选方案是从 `learning_events` 重算最近 N 次事件的窗口计数（事件流是事实源，掌握度本就是导出值），试点数据出来后评估；
2. 互动实验、动画步骤事件是否以及如何进入公式（当前只记录不计分）；
3. BKT+forgetting 影子基准和 FSRS 替换的启动时机；
4. 提案标签的人工评审流程与频率。
