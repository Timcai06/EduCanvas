# 项目路线图

- 状态：`draft`

本文件维护跨阶段目标和长期交付边界，不维护某个PR或短周期阶段的任务清单。当前执行计划及验收证据见[`../plan/README.md`](../plan/README.md)；计划完成后，稳定事实应回写到对应canonical文档或ADR，本路线图只更新阶段级进度与范围变化。

产品主线是Chat-first全模态AI平台；K12 AI教师是首个垂直Agent与当前竞赛验证场景。平台能力与教学能力按[ADR-0009](../09-decisions/0009-general-multimodal-platform-and-k12-vertical.md)分层演进。

## 阶段一：通用Agent基座与首个K12纵切

目标：在不重写现有真实Turn纵切的前提下，将通用模型、消息、工具和Artifact契约从教学领域增量解耦，同时完成“AI如何识别猫和狗”的跨学段K12 Agent闭环。

平台基座：

- Chat-first通用对话入口；
- 供应商无关的消息、模型运行和流式事件契约；
- 多模态附件与长期Asset的通用语义；
- 通用Artifact提议、确认、生成和Studio生命周期；
- 可注册的垂直Agent与工具能力；
- K12、研究、创作等垂直能力不得复制平台基础设施。

K12垂直纵切：

- 学段选择；
- AI教师对话；
- 教材RAG；
- 一个GSAP动画；
- 一个互动分类实验；
- 一个测验；
- 一个Python实验；
- 编译期静态Artifact注册表；
- 版本化学习事件契约与核心协议测试；
- 掌握度更新；
- 下一步推荐。

已完成的产品与运行时基线：编译期静态Artifact注册表、公开题面/私有判分键分离、匿名高熵HttpOnly Cookie与数据库哈希身份、Session/Artifact原子bootstrap、Server Action提交、运行时归属校验、确定性服务端判分、可信测评事件事务写入、Canvas/Progress持久化回显与Drizzle Port适配；Chat-first深色学生端、无Provider诚实错误态、Canvas协作区、资产/进度/产物抽屉与基础UI GSAP动效。

真实Agent基础设施已经完成A2/A3/A4与S1基线：固定Turn/Cancel Route和版本化EduCanvas SSE、可配置的原生OpenAI-compatible Provider Adapter、`answer → tools → synthesis`两阶段编排、首个只读`getStudentState`工具、消息/Model Run/Tool Call/安全决策账本、发送幂等、单会话活动Turn限制、PostgreSQL窗口限流、租约/heartbeat、显式取消和刷新恢复。`ScriptedModelGateway`仅保留在确定性测试边界，未配置Provider时不会生成伪回答。

通用Asset首条纵切已经实现匿名所有权、不可变版本、PDF/图片上传、PDF文本解析、消息Part和刷新恢复；当前文本Provider不支持图片时会明确失败。K1的数据层与Web纵切已经接通审核资料不可变版本、PostgreSQL FTS、Turn资料快照、检索候选、防伪引用、引用SSE和UI。T1的Core/Runtime已经实现可信状态推进、事件回放、掌握度更新与下一节点推荐，Web在Canvas判分后仅对可信`ASSESS`状态完成了首条推进接线。C1的Artifact提议、学生确认、独立生成和真实Studio列表尚未实现。

已完成的验证基线覆盖单元测试、真实PostgreSQL集成测试和Playwright E2E；CI拆分为基础检查、集成测试和浏览器E2E三个job，具体数量和通过状态以当前分支CI为准。

阶段一剩余工作按平台与垂直纵切拆分：

1. 修复连续对话和诚实终态：历史Context Snapshot、完整Parts重试、输出截断状态和实际引用子集；
2. 建立通用Space/Conversation/Message/Operation数据骨架，把`lesson_sessions`迁移为K12 Vertical Context；
3. 将通用Turn、Context、Tool Registry、Policy和Trace Port迁入`agent-runtime`，K12作为首个Agent Profile注册；
4. 统一Asset/Source/Representation/Chunk/Citation链路，加入异步解析、恶意文件扫描、对象删除和原生多模态Provider；
5. 为中文检索建立冻结评测集，并按指标引入关键词/n-gram、Embedding和Rerank；
6. 实现平台级Artifact提议/确认/生成/版本/Studio生命周期，并由K12 Agent注册首批受控Artifact；
7. 补齐T1非`ASSESS`节点的可信事件接线，并验证完整状态回放与下一节点推荐；
8. 将通用对话、长期Sources、受控Artifact、教学判分、状态推进和刷新恢复串成完整E2E，再执行受控Provider live smoke。

## 阶段二：平台化

- 多模态Asset上传、解析、版本和权限；
- Artifact版本兼容、组合、编辑和管理能力；
- 可插拔Agent能力注册与Workspace模板；
- K12课程组合、教材审核与教师端；
- 多供应商路由、Fallback、熔断、配额与成本治理；
- Embedding版本管理；
- 教师端基础能力；
- 完整监控和评测集。

## 阶段三：生产强化

- 并发与容量测试；
- 服务横向扩容；
- 跨供应商模型容灾；
- 数据备份与恢复演练；
- 未成年人隐私流程；
- 灰度发布和回滚；
- 班级与学校多租户能力。

## 阶段四：竞赛交付

- 演示路径；
- 项目报告；
- 系统架构图；
- 技术路线；
- 测试和评测结果；
- 部署说明；
- 演示视频与答辩材料。
