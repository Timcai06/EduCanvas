# Claude Code 模式研究

- 状态：`research`
- 核验日期：2026-07-21
- 权威来源：Anthropic 官方 Claude Code 仓库与官方文档
- 辅助样本：本机 `Documents/claude-code源码`；其 README 自述为泄漏源码并包含 stub，只提供非权威实现线索

## 一、研究边界

Claude Code 是面向开发工作的 Agent 产品，不是 K12 教师平台。可以研究它如何维持长 Turn、过滤工具权限、处理取消、压缩上下文和跨界面审批；不能复制未确认来源代码，也不能把 cwd/worktree、Shell 权限或开发者信任模型直接映射为 EduCanvas Notebook。

任何进入 ADR 的 Claude Code 事实应由[官方仓库](https://github.com/anthropics/claude-code)或 Anthropic 官方文档再次确认。本地第三方样本不作为许可证、接口稳定性或产品行为的证明。

## 二、可借鉴的产品模式

### 1. 一个 query loop，多种工具与显示面

成熟 CLI Agent 的核心价值不在多套专用循环，而在一个受控循环上装配不同上下文、工具和权限。EduCanvas 已有唯一 `AgentLoopEngine`，下一步应收敛 Turn Application 与 Tool Kernel，而不是为教学、TUI 或渠道再造 Loop。

### 2. 工具可见性与执行权限分离

模型知道工具存在，不等于工具一定可执行。权限过滤、用户批准、环境约束和结果审计必须发生在模型之外。EduCanvas 还需额外叠加 Actor、Notebook Membership、未成年人安全与领域可信事实。

### 3. Abort 是运行语义，不是 UI 状态

取消必须穿过模型流、工具执行和持久 Operation，形成唯一终态。CLI 中按键中止只是入口；EduCanvas 要让 Web、TUI 和渠道对同一 Operation 得到一致结果，并处理跨进程或重启后的 owner/lease。

### 4. 远程审批是控制桥，不是权限源

用户可以从另一个界面批准或拒绝动作，但 Gateway 仍需校验审批主体、参数绑定、有效期和 Operation 状态。审批记录完成不代表计算已经恢复；continuation 需要独立、可幂等的执行语义。

### 5. Compaction 与会话切换属于产品能力

长对话需要压缩、恢复和切换，但摘要不能成为不可追溯的新事实。EduCanvas 应把 Context Snapshot 与 Notebook/Conversation ID 对齐，保留 Sources、tool pair 和学习事实引用，并允许 Web/TUI 无损切换同一 Conversation。

## 三、采用、适配与拒绝

| 判断 | 内容                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 采用 | 单循环；工具权限过滤；显式 abort；审批桥；上下文压缩；稳定会话切换                                     |
| 适配 | 把开发会话映射为 Notebook/Conversation/Operation；把 permission mode 映射为 Tool Kernel 的有效能力交集 |
| 拒绝 | 本地第三方源码作为权威；cwd/worktree 充当 Notebook；默认 Shell/任意文件访问；开发者单用户信任模型      |

## 四、对第二代架构的直接影响

- 保留 `AgentLoopEngine`，避免 framework-first 重写；
- 将权限、审批和取消收敛到 Gateway + Tool Kernel，而不是 UI 组件；
- Web/TUI handoff 继续以服务端身份和一次性凭据实现，不把 Conversation ID 当授权；
- Context Snapshot 与 compaction 需要来源、工具配对和删除策略；
- 对本地样本只记录模式，不摘录或迁移未知许可证代码。

## 五、待验证问题

- 官方公开接口能否充分证明 steer、abort、permission 与 compaction 的终态细节；
- EduCanvas 是否需要独立 steer，还是“取消后带上下文重发”已经足够；
- 远程批准后的 runner ownership、lease 和 effect ledger 如何设计；
- TUI 的开发者效率模式与 Web 的 K12 安全默认值如何共享同一 Tool Kernel 而不共享相同权限。
