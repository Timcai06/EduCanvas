# 项目路线图

- 状态：`accepted`
- 负责人：项目负责人
- 最后验证时间：2026-07-19

EduCanvas 的长期方向是**以教育能力为核心的通用个人 Agent 平台**。Gateway-first 基础架构已完成，当前路线图从“建边界”转为“补真实生产能力与教育质量”。完成证据见 [Gateway-first 计划](../plan/completed/2026-07-gateway-first-personal-agent.md)。

## 已完成：产品与 Gateway 边界

- 确定一人一Personal Agent、家庭/班级共享Notebook而不共享Agent身份；
- 冻结Client/Channel/Node/Operator、Envelope、Event、能力、审批、投递和恢复协议；
- 建立User/Agent、Membership、Delegated Grant和Actor审计数据边界；
- 落地`apps/gateway`、持久Operation Event、幂等、恢复、审批、Client/Node session；
- 保留`apps/ + packages/`宏观结构并增加真实组合根/协议包，没有创建空占位模块。

## 已完成：Web 与唯一 Runtime

- Web Chat/Learn Route通过Gateway兼容层进入可信Envelope；
- 通用、K12和独立Gateway Runner共用唯一`AgentLoopEngine`；
- 保持历史切换、Sources/Studio隔离、引用、Artifact、可信判分、取消、幂等和刷新恢复；
- Web继续输出兼容SSE，但不再定义跨客户端永久协议；
- PostgreSQL迁移全部additive，保留旧教育账本用于领域事实和回放。

## 已完成：第二客户端、渠道与安全 Node

- TUI支持认证bootstrap、会话选择、流式Chat、status、resume和审批；
- Telegram私聊文本Adapter支持账号/线程绑定、Update去重、Delivery回执和官方形状离线Fixture；
- Capability Node支持出站配对、心跳、撤销、状态与白名单只读文件；
- Traversal、symlink escape、绝对路径、Shell/写入、过期与重放请求均被拒绝；
- Web/TUI同路由、共享Notebook隐私、审批、Channel投递和Node生命周期都有自动化证据。

## 当前 P0：正式身份与生产运维

- 接入正式IdP、账号恢复、session撤销和密钥轮换，移除最终用户对共享bootstrap token的依赖；
- 增加Gateway/模型/工具限流、并发舱壁和成本配额；
- 把现有安全结构化日志/指标接入外部Trace、SLO和告警；
- 完成备份/PITR、恢复演练、对象删除Outbox和隐私导出/更正/删除流程；
- 用户提供Telegram测试凭据后执行受控live smoke，再决定long polling或Webhook生产拓扑。

## 当前 P1：Context、多模态与教育质量

- Notebook摘要、长期学习者记忆、Artifact Context和统一检索预算；
- 上传Asset统一进入Source/Representation/Chunk链路；
- 原生图片、语音和后续视频输入输出；
- 建立年龄、学科、任务分层的教学评测集，评测讲解、追问、证据、误区、练习适配和安全；
- 完成结构化课程从诊断、练习到评价/补救的证据，并提供教师资料审核与学习证据视图。

## 后续 P2：受控能力扩展

- Profile/Skill/Tool/Channel注册、版本和兼容治理；
- 多供应商显式路由、Fallback、成本和质量评测；
- 只有成年/管理员场景、安全评审和可恢复审批续跑完成后才增加L2/L3 Node能力；
- 只有真实连接规模、隔离或发布压力出现时才拆分Gateway、Runtime或Worker服务。

## 竞赛交付线

- K12演示路径、课程内容和可信判分；
- 当前Gateway/Runtime架构图、测试与安全证据；
- 部署说明、演示视频和答辩材料；
- 明确区分已实现的离线Telegram/Node纵切与仍缺凭据/云部署的production证据。

## 长期非目标

- 复制OpenClaw的全部渠道、插件市场和单用户信任模型；
- 用多Agent数量、工作流复杂度或长视频衡量教育价值；
- 默认向未成年人开放Shell、任意文件系统或设备控制；
- 在没有负载和隔离证据时提前拆微服务；
- 让模型自述替代身份、权限、判分或掌握度事实。
