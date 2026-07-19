# 核心用户流程

- 状态：`draft`
- 负责人：项目负责人
- 最后验证时间：2026-07-19

## 从任意表面继续同一个 Agent

```text
用户从 Web / TUI / 已配对渠道发出消息
→ Gateway 验证身份与入口能力
→ 路由到绑定的 Notebook / Conversation
→ Agent Runtime 装配 Sources、历史、记忆与附件
→ Agent 回答或使用受控工具
→ Gateway 按表面能力投递文本、媒体、卡片或 Web 深链接
→ 终态、Trace 与产物可从其他表面恢复
```

当前只实现 Web 纵切；TUI、Channel 和 Gateway 路由仍是目标能力。

## 在家庭或班级 Notebook 中协作

```text
用户以自己的身份进入共享 Notebook
→ Gateway 校验 Membership 与委托权限
→ 请求绑定真实用户、其个人 Agent 和目标 Notebook
→ Runtime 只装配获授权的共享内容与本人允许的私人上下文
→ 产物和对话按 Notebook 规则共享
→ 私人记忆、凭据、设备能力和其他 Notebook 保持隔离
```

教师或家长查看学习信息时使用显式委托权限；不能切换成学生 Agent 或以学生身份执行操作。

## 学生自由提问

```text
提出问题或上传资料
→ 教育 Profile 识别年龄、意图与已有可信信息
→ 检索 Notebook / 审核资料
→ 选择文字、图片、语音、Canvas 或练习形式
→ 回答并追问理解情况
→ 仅在产生可验证证据时写入学习事件
```

自由问答不自动创建课程状态，也不因为模型声称“理解了”就更新掌握度。

## 结构化课程

```text
显式选择课程或接受教师任务
→ 诊断已有理解
→ 讲解与示范
→ 练习
→ 服务端判分
→ 生成可信学习事件
→ 更新掌握度并决定补救或下一节点
```

结构化课程是教育能力的一种 Workflow，与自由问答共享同一个 Agent Runtime。

## 远程发起任务

```text
用户从已配对渠道发送文本/语音/文件
→ Gateway 解析到明确 Notebook
→ Runtime 评估工具和风险等级
→ 低风险任务直接执行
→ 高风险任务请求 Web/TUI 审批
→ Worker 执行长任务
→ 原渠道收到进度和结果
```

学生默认不开放主机 Shell、任意文件系统或设备控制。

## 教师管理资料

```text
教师通过 Web 上传文件
→ 身份与目标课程/Notebook授权
→ 安全扫描、OCR与版面解析
→ 切块、索引与抽样审核
→ 发布到指定范围
→ 学生 Agent 只能在授权范围内检索
```

## Artifact 共创

```text
用户请求生成导图 / Slides / 练习 / 音频
→ Agent提出产物或用户显式确认
→ Worker生成不可变版本
→ Studio恢复产物
→ Web Canvas继续修改并追加版本
→ 弱能力渠道获得摘要和受权深链接
```
