# ADR-0034：Notebook 来源计划与多会话导航

- 状态：`accepted`
- 日期：2026-10-02
- 决策人：项目负责人（本次任务明确确认）
- 来源：GitHub issue #475；ADR-0003、ADR-0020

## 背景

Notebook 以 Space 为聚合根，但 Web 仍以主 Conversation 的一对一投影管理笔记本，学习入口按活动 Session 恢复。计划需要按对话与资料章节组织；现有结构化 Goal/Objective/Session 是可信教学事实，不能把普通计划条目当作新的课程或掌握度。

## 候选方案

1. 将 Goal 下沉到每个对话/章节并放宽 active 唯一约束：会改变诊断、Session 定位与可信目标图，不符合本次确认的共用总学习目标。
2. 新增 Notebook 内来源 Plan，保留总 Goal：采用。
3. 按标题自动合并旧课程到已有科目 Notebook：没有确定归属，拒绝；保留旧资源域。

## 决定

1. Notebook 是一级归属与导航单位；同一本可拥有多条 Conversation、Sources、Artifacts 及多份 Plan。Notebook 与 Conversation 命名/归档相互独立；新普通对话不创建教学 Session。
2. Plan 是用户明确保存的计划条目，包含标题、内容与 active/completed/archived 状态；其唯一来源为一个 Conversation、一个 Chapter 或一个明确 purpose 节点。来源与 Plan 必须同 Notebook；多份 Plan 不互相取代，不要求每来源只有一份。
3. 多份 Plan 共用 Notebook 的总学习 Goal，保留 `learning_goals_notebook_active_unique`；不为 Plan 创建新的 Goal、诊断、学习事件、Session 或掌握度。Goal 由 Study 服务维护，Plan 不另存可能漂移的总目标副本，读取时关联当前 active Goal。共享 Notebook 中总 Goal 的私人学习者字段只对其本人公开，成员不能借计划目录读取他人的诊断。
4. 首期 Chapter 是用户显式创建/确认的资料分组，冻结 AssetVersion 与整份资料、页码范围或文本范围；可依可靠已知结构显式保存。不得从标题、模型输出或无目录资料自动推断稳定章节。无章节时可显式使用整份资料分组；仅有学习目的时使用 purpose。页码/文本范围是用户声明，不宣称已自动校验书籍天然目录。
5. Chapter 创建只接受当前 ready、同 Notebook 的 Source/Version；读取或修改 Plan 时重新检查来源可用性。对话归档、资料撤销或版本改变后标记 unavailable，禁止继续完成/恢复为 active，但仍可归档；原计划文字保留为已显式保存的历史内容。永久删除来源按复合外键级联删除其 Chapter/Plan；Notebook 生命周期拥有这些子实体。
6. owner/editor 使用现有 `conversation.create` 权限写 Plan、`source.write` 权限创建资料分组；有效成员通过 `notebook.read` 读取。contributor/viewer 不新增内容写权限。创建者、Notebook、权限来自服务端可信身份；mutation ID 在 Notebook+创建者内唯一，重试同内容重放，复用 ID 携带不同内容返回冲突；所有写入同事务记安全审计。
7. `/notebook/<spaceId>` 是 Notebook 导航地址；具体 Conversation 在该 Notebook 内显式寻址。路径决定当前 Notebook，Cookie 只服务旧入口的默认恢复；陌生/越权/路径归属不符不可跳到另一本 Notebook。URL 本身不授予分享权限，所有读取/写入重新校验 Membership。
8. 保留旧 course Space、Conversation、Goal、Objective、Session 及消息/资源 ID，不迁入别的 Notebook，不回填猜测来源。历史课程保留真实课程工作区与可继续入口；新 Plan 不复制已有教学账本。
9. `/learn` 与 `/open?token=…` 保留兼容。交接凭证仍先原子一次性消费再导航到鉴权后的真实 Notebook/Conversation，资源 focus 保持；短期 token 不变成永久链接授权。`/learn` 不因路由合并就宣称教学行为等价或已退休。
10. 新 Plan/Chapter API 属于第一方 Web BFF，不改变公共 `gateway.v1` 协议。新增 schema/migration 为 additive；历史迁移不可修改，生产迁移另按正常交付流程执行。

### Notebook 内教学 Session 隔离

项目负责人在本次整合审查中确认：同用户同课程在两个 Notebook 中学习不得互相归档。`lesson_sessions.notebook_id` 从原 Conversation 的 Space 确定性派生；绑定会话按 Notebook + 学习者 + 学段 + 课程 + 知识节点唯一 active，历史无 Conversation 的未绑定会话维持旧 scope。创建、锁、归档、恢复与补偿都使用实际 Notebook；旧 `/learn` 未显式选择时仅读取最近可用记录，新建别本不改变原本的 active 状态。总 Goal 唯一性仍按 Notebook，诊断与恢复还必须匹配 Goal 的课程/学段/知识节点和请求的实际 Session/Conversation，不能拼接同本另一课程的总目标。0063 只回填可证明归属，不重新划分历史科目、不改变 Session 原 ID/状态或教学状态机。

## 后果

- 计划可随对话或显式章节管理，完成状态只是计划工作状态，UI 必须继续使用可信教学投影展示掌握度。
- 0062 增加两张空表与资产复合唯一索引，不改写历史 course/Goal/Session；0063 仅为旧 Session 补入已可证明的 Notebook 归属；索引建立会扫描资产表，上线须按实际规模评估锁窗口。
- 自动章节抽取、自动学习计划生成、历史课程跨 Notebook 合并不属于本次已批准首期。
- 未完成的导航、UI 与等价验证仍以实施证据为准，本 ADR 记录已批准方向，不声明未验证能力已上线。

## 验证方式

- fresh 与 N-1 disposable 数据库迁移成功；旧 course/Goal/Session 值及唯一 active Goal 约束保持。
- 同 Notebook 对话、章节与 purpose Plan 共存；跨 Notebook Conversation/Source/Chapter 挂载被仓储和数据库复合 FK 拒绝。
- viewer、contributor、已撤销或过期成员不能写；匿名无身份及非法 UUID/跨 Origin 请求由 HTTP 边界拒绝。
- 同 mutation ID 并发重放只写一次，不同内容冲突；资料版本漂移或对话归档后 Plan unavailable。
- Notebook URL、刷新/前进后退、旧 Cookie 与 handoff 兼容不串 Notebook；已有教学状态机与掌握度测试保持。
