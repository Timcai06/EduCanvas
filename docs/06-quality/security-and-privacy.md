# 安全与隐私

- 状态：`draft`

## 未成年人数据

- 默认使用昵称或匿名ID；
- 不收集完成教学不需要的真实身份；
- 学生图片、语音和教材文件分区存储；
- 明确保留期限与删除机制；
- 敏感日志脱敏；
- 生产环境遵循适用的个人信息和未成年人保护要求。

## 当前匿名纵切边界

- 首次显式开始课程时生成32-byte高熵随机token，使用无padding base64url规范编码；
- token仅写入HttpOnly、SameSite=Lax Cookie；生产环境同时启用Secure和`__Host-`前缀，阻止Domain Cookie覆盖；
- PostgreSQL不保存原始token，只保存带版本前缀的SHA-256派生学生标识；
- Cookie仅在已经拥有有效会话时复用；否则开始课程会轮换新token，数据库读取同时执行30天服务端有效期检查；
- 页面和提交边界不接收客户端student ID或session ID，而是从Cookie身份和服务端课程范围恢复会话；
- 教学运行时在事务内再次校验session属于可信学生，归属失败统一返回会话不存在；
- 浏览器只接收公开Artifact、判分反馈和Progress DTO，不接收私有判分键或内部学习事件。

Playwright已覆盖匿名Cookie隔离、生产`__Host-`属性、无会话Cookie轮换和篡改Cookie后无法读取原会话；真实PostgreSQL集成测试覆盖错误归属不写事件/掌握度。当前token仍是bearer凭证，匿名机制没有账号恢复、主动撤销、角色授权或跨设备登录；正式用户认证、CSRF专项验证、匿名bootstrap限流/配额、过期数据清理和隐私生命周期仍是生产上线门禁。

## 模型安全

- `packages/teaching-core` 已固定 `k12-safety-v1` 决策契约与
  `deterministic-k12-detector-v1`：`evaluateTeachingInput()` 在 Provider 前检查
  大小、PII、Prompt injection、自伤、虐待、露骨性内容、暴力和危险行为；
- `packages/teaching-runtime` 的 `TeachingOutputSafetyGate` 在浏览器写出前按小段
  缓冲 delta，跨 chunk 命中后清空未释放正文、永久关闭正常输出，并只返回固定的
  中英文年龄适配文案；
- decision 只含 `phase / category / action / policyVersion / detectorVersion /
policyCode`。安全账本不保存 `policyCode` 和正文；公开结果、普通日志与指标都不含
  命中原文、匹配规则、system Prompt 或供应商推理；
- answer 与 synthesis system Prompt 已注入同版本 K12 policy，涵盖年龄适配、事实
  不确定性、隐私最小化、危险操作边界和高风险升级提示；
- 当前检测器是确定性首道边界，不等同于完整语义审核或生产未成年人安全认证；未接入
  第三方 moderation，真实课程上线前仍需人工红队、误报/漏报评测和合规复核；
- `TeachingObservabilityPort` 使用封闭指标联合，只允许 provider/task/model/tool alias、
  稳定 code 与非负数值；禁止任意 labels、正文、Trace、学生/session/message ID；
- RAG内容与用户指令分离；
- 上传文件视为不可信输入；
- 工具使用服务端白名单；
- 高风险内容进入安全回答流程；
- 记录模型、Prompt、证据和工具调用。

## 代码与Canvas安全

- Python和JavaScript代码在隔离沙箱运行；
- 默认禁止访问内网、文件系统和任意外网；
- 限制CPU、内存、运行时间和输出大小；
- 模型生成的Canvas只使用允许的组件和属性；
- 禁止直接渲染未经清理的HTML。

## 仓库安全

- 不提交密钥和真实`.env`；
- 启用依赖和秘密扫描；
- `main`启用分支保护；
- 生产权限使用最小权限原则；
- 关键操作保留审计日志。
