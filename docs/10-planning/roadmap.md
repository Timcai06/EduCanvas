# 项目路线图

- 状态：`accepted`
- 负责人：项目负责人
- 最后验证时间：2026-07-23

EduCanvas 的长期方向是**以教育能力为核心的通用个人 Agent 平台**。默认 Agent 可以研究、创作、整理资料和进行普通教学问答；诊断、练习、测评、掌握度与可信学习证据通过按需结构化 K12 Workflow 提供。

## 已完成基础

- 一人一 Personal Agent；家庭与班级通过共享 Notebook 和角色授权协作；
- Gateway 身份、Notebook 路由、Operation、审批、事件恢复、Connections 与投递控制面；
- Web、TUI、实验性 Telegram Channel 和只读 Capability Node；
- 唯一 `TurnApplicationService`、`AgentLoopEngine`、Context Engine 与 Tool Kernel；
- General、K12、Gateway 三条生产路径共享统一运行语义和账本；
- PostgreSQL 事实源、graphile-worker 持久任务、Artifact/Studio/Canvas 和可信学习事实；
- approval continuation、跨进程 cancel/lease、可回滚 Provider Adapter 与脱敏 Trace Adapter。

## 当前：第二代架构有限收口

执行计划：[第二代架构收口](../plan/active/2026-07-第二代架构升级.md)。

- 统一 README、产品、架构、ADR 与计划中的当前事实；
- 补 Web/TUI/Gateway 的 Notebook、Profile、Tool Policy、approval、send/abort 和终态一致性证据；
- 完成仅限内部受信主体的 append-only 人工 Effect 对账入口；
- 清理重复实现和过期研究导入；
- 通过全量工程门禁、PTY、E2E、安全与代码质量复核后结档。

自动 effect verifier、完整 OTel Collector、正式 IdP、Memory 与原生多模态都不是该架构 Goal 的完成前置条件。

## 下一阶段一：Notebook Context 与 Memory

- Notebook 摘要、Conversation compaction 与统一上下文预算；
- 区分 Personal Memory 和 Notebook Memory，提供来源、版本、删除与共享边界；
- Artifact Context、长期来源摄取和检索质量；
- Memory 未实现、禁用或无权限时保持明确 unavailable。

## 下一阶段二：原生多模态

- 图片与 PDF 页面原生模型输入；
- 语音输入、转写、语音输出与可访问文本等价物；
- 后续视频能力必须有成本、版权、来源与未成年人安全证据；
- 上传 Asset 统一进入 Source/Representation/Chunk 管线。

## 下一阶段三：教育质量

- 建立年龄、学科和任务分层的教学评测集；
- 评测讲解、追问、误区识别、证据引用、练习适配与安全；
- 打通普通教育问答与结构化课程的自然进入/退出；
- 提供教师资料审核、学习证据视图、复习建议与不过度操纵的反馈。

## 生产发布门

产品能力推进可以与以下工作并行，但 production 声明前必须完成：

- 正式 IdP、账号恢复、session 撤销与密钥轮换；
- Gateway/模型/工具限流、并发舱壁与成本配额；
- 外部 Collector、SLO、告警、备份/PITR 和恢复演练；
- 对象删除 Outbox、隐私导出/更正/删除；
- enabled Channel Adapter 的生命周期、degraded health 与真实平台凭据验证。

## 受控扩展

- 微信/QQ 等渠道只有取得平台资格和凭据后才实现，不以假二维码冒充；
- 自动 Effect 对账只有真实 write Adapter 提供受信查询或服务端幂等契约后才实现；
- L2/L3 Node 只允许成年/管理员场景，并需单独安全评审；
- LangGraph 仅在有界复杂 Workflow 证明至少 30% 总成本收益后重新评估；
- 只有真实连接规模、故障隔离或团队发布压力出现时才拆分服务。

## 长期非目标

- 复制 OpenClaw 的全部渠道、插件数量或单操作者宿主机信任模型；
- 让所有教育问题强制进入五阶段课程；
- 用多 Agent、工作流复杂度或长视频代替教育价值；
- 默认向未成年人开放 Shell、任意文件系统、Credential 或设备写能力；
- 让模型、客户端、Trace 或框架 Checkpoint 写入身份、权限、判分或掌握度事实。
