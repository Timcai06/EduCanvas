# 产品定义

- 状态：`accepted`
- 负责人：项目负责人
- 最后验证时间：2026-07-19
- 关键决策：[ADR-0015](../09-decisions/0015-education-centered-personal-agent-platform.md)

## 一句话定义

EduCanvas 是一个**以教育能力为核心的通用个人 Agent 平台**：用户拥有一个能够长期理解自己、学习资料、使用受控工具并完成任务的 Agent，可以通过 Web、TUI 和消息渠道随时与它协作。

## 产品北极星

Agent 是产品主体，不是某个页面里的功能。Gateway 让同一个 Agent 持续在线并连接不同客户端、消息渠道和设备；Notebook 管理长期上下文；统一 Runtime 负责推理和行动；教育能力提供区别于普通个人 Agent 的核心体验与可信边界。

EduCanvas 不复制 OpenClaw。它吸收 Gateway-first、多渠道和常驻 Agent 的结构，同时把 Notebook、Sources、Artifact、Canvas、学习者记忆、可信判分和结构化课程组合成自己的教育能力。

## 用户心智模型

每个用户拥有一个长期个人 Agent。Agent 可以在多个 Notebook 中工作：

- **Sources**：资料、网页、搜索结果和长期知识；
- **Conversations**：Notebook 内的一条或多条对话；
- **Studio**：生成的导图、Slides、音频、文档和交互 Artifact；
- **Canvas**：Artifact 的富交互与版本共创表面；
- **Memory**：与用户相关、可解释且受权限控制的长期记忆；
- **Profile / Skills**：当前专业行为和按需工作流。

Web、TUI 或消息渠道只是访问同一个 Agent 的不同方式。切换 Notebook 必须整体切换 Sources、Conversations、Studio、Artifact 和相关记忆。

每个自然人用户拥有自己的个人 Agent。家庭与班级协作通过共享 Notebook 和角色授权完成，而不是多人共用一个 Agent：

- 私人记忆、私人 Notebook、凭据、设备配对和默认工具权限只属于本人；
- 共享 Notebook 可以包含班级资料、家庭资源、协作对话和 Artifact；
- 教师、家长和管理员只获得显式授予、可撤销、可审计的范围权限，不能冒充学生；
- 同一个共享渠道线程中的消息仍保留真实发送者和各自 Agent，学生学习证据继续按学生主体隔离。

## 教育为什么是核心

教育不是第二套 Agent Runtime，也不是一个可有可无的演示 Profile。默认对话不会假定用户正在上课，也不会把普通问题强制转成课程；EduCanvas 始终具备：

- 根据年龄、问题和已有理解调整表达；
- 学习 Notebook 中的多模态资料并给出可追溯回答；
- 通过追问、示例、图片、语音、Canvas 和练习帮助理解；
- 使用服务端判分和可信学习事件，而不是让模型自行宣布掌握；
- 在需要时进入结构化课程，提供诊断、练习、评价和补救；
- 对未成年人、教师和家长角色执行不可绕过的权限与安全策略。

同一个 Agent 也可以完成研究、创作、信息整理和个人任务。通用能力不能依赖课程状态，但其他 Profile 也不能绕过教育身份已有的安全限制。

## 交互表面

- **Web**：完整教育客户端，承载 Chat、Sources、Studio、Canvas、多模态上传和复杂审批；
- **TUI**：正式第一方高级客户端，承载聊天、任务、运行状态、日志与工具审批；
- **Channels**：微信、QQ、飞书、Telegram、Discord、短信、语音等远程入口；
- **Nodes**：经配对的手机、电脑或设备能力宿主。

不同表面不要求像素或功能完全相同。渠道无法呈现 Canvas 时应返回摘要、媒体、卡片或 Web 深链接。

## 核心能力

1. **EduCanvas Gateway**：身份、配对、渠道、路由、能力协商、审批和事件分发；
2. **Notebook / Sources / Memory**：长期上下文与知识归属；
3. **Agent Runtime**：唯一模型循环、Context Engine、工具策略、预算和 Trace；
4. **Tools / Skills / Profiles**：通用行动和专业能力组合；
5. **Artifacts / Studio / Canvas**：持久、版本化、可继续共创的产物；
6. **Trusted Education Services**：判分、学习证据、掌握度、课程与未成年人安全；
7. **Durable Workers**：不依赖客户端在线的摄取、生成和维护任务。

## 信任边界

- 所有入口都使用 Gateway 定义的身份、配对和路由权威；Web 可以通过共进程 BFF Adapter 使用这些服务，远程入口使用 Gateway 协议；
- Agent 只能调用本轮获准的工具；
- 模型、浏览器、渠道和设备不能直接写入成绩或掌握度；
- 高风险动作必须支持明确审批、幂等和审计；
- 模型代码不在主页面执行，探索型代码只能进入隔离沙箱；
- 不支持的媒体或设备能力必须诚实失败。

## 当前非目标

- 不为 Web、TUI、K12 或某个渠道复制 Agent Loop；
- 不把五阶段课程设为所有教育对话的前置条件；
- 不把共享 Notebook、群聊或家庭/班级关系实现为共享 Agent 身份；
- 不默认向学生开放设备控制、宿主机 Shell、任意文件系统或任意代码执行；
- 不用多 Agent 数量、虚拟人或长视频替代真实教育价值。

首个竞赛交付面见 [K12 垂直产品简报](../00-overview/project-brief.md)。
