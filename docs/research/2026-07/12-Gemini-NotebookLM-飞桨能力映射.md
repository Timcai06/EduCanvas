# Gemini、NotebookLM 与飞桨能力映射

- 状态：`draft`
- 负责人：项目负责人
- 最后验证时间：2026-07-23
- 适用提交：`60eca48`
- 研究对象：Gemini Study Notebook、NotebookLM / Gemini Notebook、飞桨 AI Studio

## 一、研究问题

EduCanvas 已完成第二代 Agent 架构结档，当前需要回答的不是“再选一个 Agent
框架”，而是下一批用户可见能力应该怎样组合：

1. Gemini Study Notebook 的自适应学习闭环，哪些属于教育产品核心；
2. NotebookLM 的来源型 Notebook，哪些应该成为长期上下文和可追溯回答的基础；
3. 飞桨 AI Studio 的课程与实验环境，哪些适合转化为 K12 的动手学习能力；
4. 三者怎样复用 EduCanvas 已有的 Notebook、Agent Runtime、Canvas 和可信学习事实，
   而不是产生第四套业务运行时。

本研究中的“飞桨”特指飞桨 AI Studio 的学习、课程、数据集与在线实践产品能力。
PaddlePaddle 深度学习框架只是它的一种执行技术，不等于 EduCanvas 必须采用的底层依赖。

## 二、核心结论

EduCanvas 的目标产品形态可以概括为：

> **Gemini 的自适应学习循环 + NotebookLM 的来源型 Notebook +
> 飞桨 AI Studio 的受控实践环境 + EduCanvas 自有的可信 Agent 与教育运行时。**

三者分别回答不同问题，不能混成一份功能清单：

| 参照产品                     | 主要回答的问题                     | EduCanvas 应吸收的核心                             |
| ---------------------------- | ---------------------------------- | -------------------------------------------------- |
| Gemini Study Notebook        | 学生下一步应该学什么               | 目标、诊断、知识目标图、短课、练习、进度与下一步   |
| NotebookLM / Gemini Notebook | Agent 应依据什么回答并生成什么     | Notebook 归属、来源选择、引用、Studio 与来源衍生物 |
| 飞桨 AI Studio               | 学生怎样通过真实操作形成理解       | 数据集、实验任务、受控执行、过程证据与自动评价     |
| EduCanvas                    | 怎样让上述能力安全、连续且可被信任 | 统一 Runtime、服务端判分、可信事件、权限和审计     |

因此，下一阶段不应先做“大而全课程平台”，也不应先接入任意 Python/Jupyter。
最小产品纵切应让一个学生在同一 Notebook 内完成：

```text
选择年级与学习目标
  → 导入自己的资料
  → 完成短诊断
  → 获得可解释的学习目标图
  → 学一小节并追问
  → 在 Canvas 中练习或实验
  → 由服务端形成可信学习证据
  → 更新进度并推荐下一步
  → 下次回来继续同一个 Notebook
```

## 三、证据边界

本文把结论分为三类：

- **官方事实**：来自产品官方公告、帮助中心或官方文档；
- **仓库事实**：由当前源码、测试与 accepted 文档直接证明；
- **研究建议**：对下一阶段产品和架构的候选映射，尚不等于 accepted ADR。

产品名称和可用范围可能变化。2026-07-23 核验时，部分 NotebookLM
帮助页已重定向到“Gemini Notebook”命名；本文保留“NotebookLM / Gemini
Notebook”以对应用户已有心智，不据此推断产品已停止或完全改名。

## 四、Gemini Study Notebook：自适应学习循环

### 4.1 官方能力事实

Google 官方将 Study Notebook 描述为面向学习目标的空间。学生可以导入课程大纲、
笔记和阅读资料，先完成自定义诊断，再获得针对薄弱点的短课和练习。系统会把目标拆成
一百多个学习目标并按主题组织，在进度面板中区分优势、重点和未开始内容，再排序推荐的
下一节课。Study Notebook 的 Sources 还与 NotebookLM 连接。

这组能力的产品价值不在“一百多个”这个数字，而在四个闭环：

1. 学生先声明目标，Agent 不靠闲聊猜测课程范围；
2. 诊断结果落到细粒度目标，而不是只给一个总分；
3. 每节内容和练习针对已发现缺口；
4. 推荐随着可信学习结果更新。

### 4.2 对 EduCanvas 的技术含义

| Gemini 能力 | EduCanvas 候选概念                | 不变量                                               |
| ----------- | --------------------------------- | ---------------------------------------------------- |
| 学习目标    | `LearningGoal`                    | 归属一个 Notebook，记录年级、主题、目标和创建依据    |
| 目标分解    | `LearningObjective` / 课程图      | 有稳定 ID、顺序与先修关系；模型不能直接改可信进度    |
| 自定义诊断  | `DiagnosticAttempt`               | 题目版本、作答、判分和覆盖目标可追溯                 |
| 个性化短课  | `LessonRecommendation`            | 由可信状态选择目标，模型负责表达，不负责伪造掌握事实 |
| 目标进度    | `ObjectiveProgress`               | 从学习事件投影，不能由模型或浏览器直接写分数         |
| 下一课推荐  | 既有 `recommendNextNode` 的产品化 | 输入只含课程图、可信掌握度和服务端时间               |
| 资料联动    | Notebook Sources                  | 课程材料仍按 Notebook 隔离，不能跨 Notebook 静默混入 |

### 4.3 不应直接复制

- 不要在第一版机械生成 100+ 目标。首个单元以 6–12 个可验证目标为宜，先证明推荐质量；
- 不要把模型写出的“学生已经理解”当作进度；
- 不要让所有普通问答强制进入诊断和五阶段课程；
- 不要为了展示个性化而伪造动态计划，计划变化必须能指向真实作答或可信事件。

## 五、NotebookLM：来源型 Notebook

### 5.1 官方能力事实

NotebookLM 允许用户添加 PDF、网页、YouTube、音频、Google Docs/Slides，以及
DOCX、Markdown、CSV、PPTX、ePub 等多种来源。Chat 可以只使用用户选择的来源回答，
在答案中提供可点击引用，并跳回对应原文上下文。

其 Studio 把同一批来源转换为 Audio/Video Overview、Mind Map、报告、
Flashcards 和 Quiz 等产物。来源并非永远指向外部最新内容：许多类型会导入一份副本，
Drive 来源则提供显式同步能力；网页通常只导入文本，YouTube 主要依赖转录文本，
音频会先转写。

### 5.2 对 EduCanvas 的技术含义

| NotebookLM 能力   | EduCanvas 映射                 | 当前应守住的边界                                      |
| ----------------- | ------------------------------ | ----------------------------------------------------- |
| Notebook          | `Space + Conversation` 聚合    | 切换时 Sources、Chat、Studio、Artifact 和记忆整体切换 |
| 多类型 Source     | Asset → Representation → Chunk | 保存类型、版本、处理状态和当前 Provider 可消费性      |
| 显式来源选择      | 本轮 Source 白名单             | 检索和引用只能来自学生可见、ready 且本轮选中的候选    |
| 行内引用          | Citation marker + 来源定位     | 下一步补 claim/span 绑定和准确跳转，不只保存来源 ID   |
| 来源同步          | `SourceVersion` / refresh 状态 | 区分导入副本、可同步来源和已失效来源                  |
| Studio            | 持久 Artifact 与不可变版本     | 产物可重开、可继续修改，并保留生成依据和版本来历      |
| Quiz / Flashcards | 受控 Artifact                  | 若影响学习进度，答案必须留在服务端并使用确定性判分    |
| 后台生成          | graphile-worker 持久任务       | 客户端离线不应丢任务；失败和进度必须诚实              |

### 5.3 不应直接复制

- 不要把 Notebook 的所有资料无差别塞进模型上下文；
- 不要把生成摘要、Audio Overview 或模型回答反向当作原始事实源；
- 不要只展示“来源卡片”而没有引用到具体回答内容的证据；
- 不要用统一“已上传”掩盖解析失败、模态不支持、来源失效或权限丢失。

## 六、飞桨 AI Studio：课程与动手实践

### 6.1 官方能力事实

飞桨 AI Studio 提供从课程学习、数据集、Notebook/VSCode 实践到模型训练、测试、
部署和竞赛的一站式环境。其教学管理覆盖课程、班级、角色、内容和自动评价；学生可以在
预装环境中完成项目，教师可以组织课程内容和考核。

这说明“学 AI”不仅是让 Agent 解释概念，还需要学生观察数据、调整参数、运行实验、
比较结果和反思误差。不过，AI Studio 面向的范围远大于 EduCanvas 当前 K12
学习纵切，不能原样搬入。

### 6.2 对 EduCanvas 的技术含义

| AI Studio 能力 | EduCanvas 候选概念           | 推荐演进方式                                        |
| -------------- | ---------------------------- | --------------------------------------------------- |
| 实验任务       | `ExperimentDefinition`       | 教师/系统定义目标、输入、允许操作、证据与完成条件   |
| 数据集         | `DatasetRef`                 | 来源、许可、版本、规模和未成年人数据边界可追溯      |
| 在线环境       | `ExecutionEnvironmentPort`   | 先受控模拟，后隔离 Python；绝不在主页面或宿主机执行 |
| 实验运行       | `ExperimentRun`              | 输入、配置、输出、日志、成本、状态和所属学生可审计  |
| 自动评价       | `GradingEvidence`            | 评分规则由服务端决定，模型只能解释结果              |
| 项目作品       | Artifact / Studio            | 结果、图表、报告和反思作为 Notebook 内可版本化产物  |
| 课程与班级     | 共享 Notebook + 未来角色用例 | 先验证单学生闭环，再扩教师编课、班级和管理后台      |

### 6.3 面向 K12 的分层

| 年级层次 | 首选交互                                   | 暂不暴露                         |
| -------- | ------------------------------------------ | -------------------------------- |
| 小学     | 拖拽分类、观察输入输出、用自然语言解释规律 | 代码、终端、复杂参数             |
| 初中     | 调整少量参数、比较训练/测试结果、识别偏差  | 任意包安装、任意网络访问         |
| 高中     | 查看数据切分、混淆矩阵、简单代码和误差分析 | 宿主机 Shell、长期凭据、无限算力 |

### 6.4 不应直接复制

- 不把 PaddlePaddle 加入核心 Runtime，除非具体实验证明它是必要 Adapter；
- 不在首个纵切开放任意 Python、包安装、网络和文件系统；
- 不先建设教师管理后台、竞赛、证书和模型市场；
- 不把“代码运行成功”当作“学生理解了”，仍需独立学习证据和解释任务。

## 七、EduCanvas 当前能力映射

以下状态以 `60eca48` 的源码和 accepted 文档为准：

| 目标能力              | 当前证据                                                                 | 状态     | 主要缺口                                         |
| --------------------- | ------------------------------------------------------------------------ | -------- | ------------------------------------------------ |
| Notebook 聚合         | 当前以一对一 `Space + Conversation` 实现，Sources/Studio 按 Space 归属   | 部分具备 | 多 Conversation、摘要与 Notebook Memory          |
| 来源上传与隔离        | PDF/图片 Asset、不可变版本、Notebook 归属和本轮选择                      | 部分具备 | 统一 Source/Representation/Chunk 管线和更多类型  |
| 来源检索与引用        | PostgreSQL FTS、候选白名单、引用 SSE/UI 与最终 marker 持久化             | 部分具备 | claim/span 绑定、定位跳转、质量评测与原生多模态  |
| Studio 持久产物       | Mind Map、Slides、Flashcards、Audio Overview，支持任务、版本和重开       | 已具备   | 各产物的真实 Provider 质量和教育评测             |
| 受控互动 Canvas       | Quiz、Classification Game、Pipeline Flow 和 HTML 隔离预览                | 已具备   | 更丰富实验协议、统一插件化 Renderer Runtime      |
| 确定性判分            | 私有答案不下发浏览器，服务端判分生成可信事件                             | 已具备   | 扩展题型与跨年级评价基线                         |
| 教学状态与掌握度      | 五态状态机、事件回放、掌握度、复习日期与 `recommendNextNode`             | 核心具备 | 非 `ASSESS` 事件接线和完整产品闭环               |
| 学习目标与诊断        | 固定猫狗分类课程和 `DIAGNOSE` 状态存在                                   | 部分具备 | 用户目标、诊断试卷、目标覆盖关系和可解释结果     |
| 自适应学习计划        | 确定性下一节点推荐纯逻辑存在                                             | 部分具备 | 可持久课程图、目标进度 UI、推荐理由和真实纵切    |
| 进度界面              | 有可信投影时显示 Progress                                                | 部分具备 | 目标级进度、重点/优势/未开始分组和历史趋势       |
| AI 实验               | 分类游戏、流程动画和展示型 HTML sandbox                                  | 很有限   | 数据集、参数化实验、隔离执行、运行账本与实验评价 |
| 教师课程与班级管理    | 产品定义有共享 Notebook 和角色边界                                       | 未实现   | 不是当前单学生纵切的前置条件                     |
| 通用 Agent 与持续运行 | 统一 Turn Application、Tool Kernel、Gateway、Operation 和 durable worker | 已具备   | 本轮无需引入新的 Agent/Workflow 框架             |

这张表说明：EduCanvas 已拥有可信教育底座，但还没有把底座组织成与
Gemini Study Notebook 同等级的完整学生流程。下一阶段的主要工作是产品纵切和教育质量，
不是再次重写运行时。

## 八、目标产品形态

### 8.1 一个 Notebook 的完整构成

```text
Notebook
├── Goal：我为什么学、目标年级与完成标准
├── Sources：教材、笔记、图片、网页、音视频及其版本
├── Path：目标图、诊断结果、当前重点、复习与下一步
├── Chat：解释、追问、反馈和行动入口
├── Studio：导图、Slides、闪卡、音频、报告和实验结果
├── Canvas：当前练习、演示或实验
└── Evidence：可信作答、判分、误区、掌握度与推荐依据
```

默认仍是 Chat-first。只有学生明确选择学习目标或进入结构化学习时，Goal、Path 和
Progress 才按需出现；普通研究、创作和问答不被强制课程化。

### 8.2 旗舰纵切

建议继续使用仓库已有主题“机器如何识别猫和狗”，但把它从固定小学分类游戏升级为
同一主题的分龄纵切：

- 小学：观察图片特征、完成拖拽分类并说明理由；
- 初中：理解训练集/测试集，调整一个参数并比较准确率；
- 高中：分析混淆矩阵、数据偏差和过拟合，完成短代码或结构化实验；
- 所有年级共享来源、目标图和可信学习事实，但内容、工具权限和完成标准不同。

这个主题能同时验证 Gemini 式自适应、NotebookLM 式来源引用和 AI Studio
式动手实践，不需要先建设完整课程平台。

## 九、建议的产品纵切顺序

这些编号是新阶段的产品纵切，不延续已结档的第二代架构 C2–C4。

### P1：学习目标与诊断基线

- 创建 Notebook 时可选年级、主题和学习目标；
- 为旗舰主题建立 6–12 个稳定目标及先修图；
- 生成或选择受控诊断，结果映射到目标；
- 展示“已经会、优先补、尚未开始”，并能解释依据。

**完成证据**：同一份作答可确定性重放出相同进度；跨学生、跨 Notebook
不能读取或更新对方证据。

### P2：自适应 Study Notebook

- 把现有 `recommendNextNode` 接入真实课程图和 Web；
- 每次只推进一个短课、一次练习或一次复习；
- 推荐理由来自可信状态，Agent 将理由翻译成学生语言；
- 刷新、跨 Web/TUI 和重新登录后继续同一学习路径。

**完成证据**：薄弱点、到期复习、先修未满足和课程完成四条路径都有测试和真实
Provider dogfood。

### P3：来源型学习与原生多模态

- 统一 Asset → Source → Representation → Chunk；
- 补引用的 claim/span 定位与来源版本；
- 接通图片与 PDF 页面原生输入，再推进语音；
- Studio 产物明确显示使用了哪些来源和哪个版本。

**完成证据**：引用正确率、无来源幻觉、跨 Notebook 隔离、模态不支持时诚实失败。

### P4：受控 AI 实验

- 先定义 `ExperimentDefinition`、`ExperimentRun` 和受控实验 Artifact；
- 第一版使用确定性分类模拟 Adapter，验证交互和学习证据；
- 只有在课程价值、安全与成本证据成立后，再增加隔离 Python Adapter；
- PaddlePaddle 只作为可替换实验 Adapter 候选，不进入 Agent Runtime 核心。

**完成证据**：参数、数据版本、输出和评价可重放；恶意代码无法访问宿主机、网络、
凭据或其他学生数据。

## 十、验收与评测

### 10.1 端到端验收

1. 学生创建带年级和目标的 Notebook，并添加至少一种自己的来源；
2. 诊断覆盖 6–12 个目标中的明确子集；
3. 诊断结果形成可解释目标进度，不使用模型自报掌握；
4. 下一课同时引用目标缺口和 Notebook 来源；
5. 学生完成一个判分练习或受控实验；
6. 服务端事件更新掌握度并给出下一步；
7. 关闭客户端后可从 Web 或 TUI 恢复同一 Notebook；
8. 来源失效、Provider 不支持或实验环境失败时给出明确不可用状态。

### 10.2 质量指标

| 维度       | 首批指标                                                   |
| ---------- | ---------------------------------------------------------- |
| 教学有效性 | 前后测增益、下一题正确率、误区识别准确率、复习后保持率     |
| 推荐质量   | 推荐与目标缺口一致率、无证据跳级率、学生采纳/跳过原因      |
| 来源可信度 | 引用支持 claim 的比例、错误引用率、无来源断言率            |
| 安全与隐私 | 跨 Notebook/学生隔离、答案泄漏、未成年人不当内容、沙箱逃逸 |
| 产品可用性 | 完成一次闭环所需时间、中断恢复率、移动端完成率、无障碍     |
| 运行质量   | Provider 延迟、Artifact 失败率、后台任务恢复率、单位成本   |

任何“个性化提升”结论都必须来自对照评测，不能仅以生成文本看起来更贴心作为证据。

## 十一、风险与决策门

| 风险                 | 早期控制                                               | 需要形成 ADR 的时点                        |
| -------------------- | ------------------------------------------------------ | ------------------------------------------ |
| 目标图爆炸           | 首单元限制 6–12 个稳定目标，版本化课程图               | 允许模型动态改图或跨课程复用时             |
| 进度被模型污染       | 只从服务端判分和可信事件投影                           | 无；这是既有信任边界                       |
| 来源版权与学生隐私   | 记录来源、授权、版本和删除边界，不进入训练语料声明     | 引入公开分享、教师批量导入或外部索引时     |
| 沙箱逃逸与算力滥用   | 先模拟 Adapter，真实执行默认无网、限时、限资源、无凭据 | 选择 Python 沙箱/第三方执行平台前          |
| Paddle 技术锁定      | 只通过 `ExecutionEnvironmentPort` 接入                 | Paddle 成为生产执行依赖前                  |
| 教师后台范围膨胀     | 先完成单学生旗舰纵切                                   | 进入班级、作业发布和家校协同时             |
| 新框架破坏唯一运行时 | P1–P4 复用现有 Runtime、Worker 和 PostgreSQL 事实源    | 只有现有边界无法满足且有对照实验收益证据时 |

## 十二、待负责人确认

研究建议默认采用以下范围：

1. 首个旗舰主题继续使用“机器如何识别猫和狗”，但覆盖小学、初中、高中三层；
2. 第一阶段目标图限制为 6–12 个目标，不追求 Gemini 的百级规模；
3. P4 先做受控模拟实验，不立即开放真实 Python/Jupyter；
4. 教师编课、班级管理、竞赛和证书延后到单学生闭环完成以后；
5. 不新增 Agent 框架；Paddle、沙箱和多模态 Provider 均通过现有 Port 接入。

这些选择确认后，应把 P1 拆成 active plan；真实 Python 沙箱、Paddle 生产依赖或教师
协作进入实施前，再分别补 ADR。

## 十三、官方资料

### Gemini Study Notebook

- [Gemini Study Notebooks are your adaptive learning partner](https://blog.google/innovation-and-ai/products/gemini-app/gemini-study-notebooks/)，Google，2026-06-25；
- [New Google tools for students and educators announced at ISTE 2026](https://blog.google/products-and-platforms/products/education/iste-students-2026/)，Google，2026。

### NotebookLM / Gemini Notebook

- [Learn about NotebookLM](https://support.google.com/notebooklm/answer/16164461)，Google Help；
- [Add or discover new sources for your notebook](https://support.google.com/notebooklm/answer/16215270)，Google Help；
- [Chat with your notebook](https://support.google.com/notebooklm/answer/16179559)，Google Help；
- [Create Audio Overviews, Video Overviews, Mind Maps, reports, flashcards, or quizzes](https://support.google.com/notebooklm/answer/16206563)，Google Help；
- [Generate flashcards or quizzes in NotebookLM](https://support.google.com/notebooklm/answer/16958963)，Google Help。

### 飞桨 AI Studio

- [飞桨 AI Studio 产品页](https://cloud.baidu.com/product/aistudio.html)，百度智能云；
- [飞桨 AI Studio 文档中心](https://ai.baidu.com/ai-doc/AISTUDIO/)，飞桨；
- [AI Studio 一站式学习与实训说明](https://ai.baidu.com/ai-doc/AISTUDIO/Tk39ty6ho)，飞桨。

## 十四、仓库核验入口

- [产品定义](../../01-product/product-definition.md)
- [学生端核心 UI/UX 规格](../../01-product/student-ui-spec.md)
- [项目路线图](../../10-planning/roadmap.md)
- [`@educanvas/web` 当前实现边界](../../../apps/web/README.md)
- [`@educanvas/canvas-protocol` 当前实现边界](../../../packages/canvas-protocol/README.md)
- [可信学习投影与下一节点推荐](../../../packages/teaching-core/src/learning-projection.ts)
- [当前猫狗分类示范课](../../../apps/web/server/teaching/demo-lesson.ts)
