# General Agent 产品知识与长期记忆

- 任务分配名：`KM 知识记忆`
- 状态：`active`
- 负责人：项目负责人
- 代码审核与最终验收：Codex
- 依赖决策：[ADR-0020](../../09-decisions/0020-Personal与Notebook长期记忆边界.md)
- 当前领取任务：`K00`

## 一、目标与边界

本线为同一个 General Agent 补两类不同的上下文能力：

1. `K` 子线提供经过筛选、版本化的 EduCanvas Product Knowledge，并把现有检索底座扩展到
   General Agent；
2. `M` 子线实现 Personal、Notebook、Conversation 三层 Memory，Memory 不能覆盖身份、
   权限、Goal、判分、掌握度或来源正文等权威事实。

Product Knowledge、Notebook RAG 与 Memory 必须拥有不同的来源、作用域和失效语义。禁止把
整个 Git 仓库、环境变量、Prompt、Secret 或未接受的路线图注入模型，也禁止创建第二个
Agent Loop 或为教育场景复制检索基础设施。

K 与 M 都会涉及 Context 和数据层，按 `K00-K03 → M00-M04` 顺序执行，不得并行修改同一
组合根。C 模型配置线可以独立并行。

## 二、原子任务

### K00：产品知识主权与语料清单

- 只读盘点 canonical 文档、公开范围、版本标识、更新责任和禁止摄取目录；
- 固定 Product Knowledge 与 System/Profile、Notebook Source、Memory 的边界；
- 产出可审计 allowlist，不修改检索代码。

完成标准：每个候选文档都有主权、版本、公开级别和失效规则；`research`、历史 snapshot、
Secret、环境配置和源码默认不进入语料。

### K01：通用检索契约与数据作用域

- 定义 General Agent 可使用的 Product Knowledge/Notebook 检索 Port 与结果 Schema；
- 复用现有 FTS、向量身份、candidate/citation 和回退语义；
- 必要的数据迁移必须把 product、course、notebook 作用域显式分开，先兼容后切换。

完成标准：跨用户、跨 Notebook、伪造版本和伪造 citation fail closed；模型、Provider 原始
响应、Prompt 与私有正文不进入浏览器错误或日志。

### K02：摄取、版本与 General Agent 工具组合

- 只摄取 K00 allowlist；内容变更产生新版本并让旧候选失效；
- General Profile 按需获得检索工具，Education Profile 仍是同一个 Agent 的能力组合；
- 不把 Product Knowledge 常驻拼进所有 Prompt。

完成标准：无产品问题时不浪费上下文预算；需要产品事实时返回可验证引用；能力未配置时
诚实 unavailable，不影响普通聊天。

### K03：冻结评测与安全收口

- 建立产品问题、Notebook 问题、无关问题、Prompt injection、过期版本和越权来源夹具；
- 比较词法与混合检索，记录质量、延迟和回退；
- Codex 审核通过后才标记 K 子线 PASS。

### M00：治理矩阵与 Memory 契约

- 所有已认证个人用户目标上均可使用 Personal Memory；匿名主体关闭；
- 年龄/身份/租户矩阵约束同意、敏感类型、保留期和监护流程，不再决定已认证用户是否拥有
  该能力；
- 固定来源、作用域、版本、状态、TTL、更正、删除、suppression tombstone 和审计字段。

完成标准：权威事实优先级、三层无隐式提升、跨作用域拒绝和删除闭包均有契约测试。

### M01：Schema 与 Repository

- PostgreSQL 保存原子 Memory、版本、来源关系、audience、状态和 tombstone；
- Repository 重新校验 owner、Notebook membership 与来源授权；
- Migration 需同时提供 fresh 与 N-1 升级证据。

### M02：Context Engine 组合

- 通过现有 Context Engine 的 `memory` 输入装配，不创建第二套 Context Compiler；
- 使用固定预算、确定性排序、冲突抑制和 Context Snapshot；
- General、Education 和 Gateway 入口遵守相同 MemoryPort 语义。

### M03：显式 Memory 产品面

- 提供查看、创建、更正、删除、禁用和来源解释；
- Personal 与 Notebook Memory 在 UI 上清楚分区；
- 第一阶段不启用聊天自动提取，不能只隐藏按钮代替服务端授权。

### M04：安全与跨会话验收

- 覆盖跨会话召回、跨 Notebook 隔离、共享 Notebook audience、来源撤权、删除后不再生成、
  敏感信息拒绝、冲突和过期；
- 真实 PostgreSQL integration、相关 Web/Runtime test、typecheck 和安全复审通过后才能 PASS。

## 三、任务提示词

```text
只执行 KM 计划当前领取的一个原子任务。先读 AGENTS.md、CLAUDE.md、ADR-0001、ADR-0003、
ADR-0015、ADR-0020、本计划与相关源码。所有 shell 命令以 rtk 开头。

不得创建第二个 Agent Loop、Context Compiler、RAG 基础设施或权威事实表；不得把整个仓库、
Secret、Prompt、Provider 原始响应或未授权 Source 注入模型。跨用户、跨 Notebook、未知版本、
来源撤权和能力缺失必须 fail closed。一个文件接近 400 行即评估拆分，手写文件不得超过
600 行。不得替 Codex 宣布 PASS，不得提交、推送或合并。

回报必须包含：基线 SHA、修改文件单一职责、验收标准到测试的映射、所有命令与退出码、
未运行项、安全边界、残余风险、回退方式、git diff --check/name-status/status。
```
