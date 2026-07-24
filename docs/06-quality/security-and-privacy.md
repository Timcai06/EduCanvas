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

Playwright已覆盖匿名Cookie隔离、生产`__Host-`属性、无会话Cookie轮换和篡改Cookie后无法读取原会话；真实PostgreSQL集成测试覆盖错误归属不写事件/掌握度。worker 已调度7天窗口外的匿名数据库主体清理，但对象存储删除Outbox尚未接通。当前token仍是bearer凭证，匿名机制没有账号恢复、主动撤销、角色授权或跨设备登录；正式用户认证、CSRF专项验证、匿名bootstrap限流/配额和完整隐私生命周期仍是生产上线门禁。

该匿名 Cookie 机制只适用于当前 Web兼容主体。TUI、消息渠道和设备Node使用各自的Gateway session/绑定，不能复用或提交匿名Cookie主体。

## 学习者画像与短诊断

- 年龄与学段只接受本人、监护人或学校的显式声明，不从文本、头像、声音、摄像头或行为推断；
- 画像不保存出生日期、生物特征、人格、心理或自由文本能力标签；未知年龄默认采用未成年人策略；
- 教学偏好是五个可修改闭集，只改变表达，不改变工具、数据、审批或安全权限；
- 浏览器诊断题面不含正确答案和内部 Objective 映射，只提交 UUID attempt 与选项；
- 服务端仓储根据受信课程重新判分，调用方提供的分数摘要不能成为事实；
- `answerFingerprint` 只保存 SHA-256；归属失败统一不可见，不能探测他人 Goal、Session 或诊断；
- `declaredByUserId` 与 `studentId` 分开审计。正式账号下的监护人/学校声明授权、导出、更正和删除仍是 production 门禁。

## Gateway、Channel 与 Node 安全

- Gateway已实现云端控制平面边界与每用户逻辑隔离；一个自然人拥有自己的个人Agent，家庭与班级只共享显式授权的Notebook/资源，不共享Agent身份；
- Public Client Schema不接受principal；Web从HttpOnly Cookie、TUI从HMAC session、Telegram从数据库绑定建立主体。内部Envelope只接受至少32字节的server bearer入口；
- PostgreSQL集成测试证明共享Notebook保存真实Actor与其个人Agent，contributor可回复，viewer与无Membership主体被拒绝；Membership不传播私人Memory、Credential、Node Pairing或默认工具权限；
- Telegram未知私信、群聊、bot消息和媒体默认拒绝；新设备必须用bootstrap凭据配对并获得可撤销Node session；
- 渠道账号映射到平台主体后仍需 Notebook 和角色授权；
- 教师、家长和管理员只能使用显式、可撤销、可审计的委托权限，不能冒充学生主体；
- 配对只确认身份，不自动授予工具、设备或主机权限；
- Channel/Node 声明的能力必须与主体权限、Profile策略和环境策略取交集；
- `gateway_approvals`保存L2/L3审批请求与actor范围决策，TUI/Web可处理，Telegram只提示升级；当前没有开放审批后执行高风险动作的产品路径；
- 学生默认只开放低风险内容/检索和经审核的教育连接器，不开放Shell、任意文件系统或设备控制；
- 本地Node只使用可撤销的出站配对连接，不持有Provider Secret；执行器只实现状态与allowlisted read，拒绝Shell、写入、绝对路径、遍历、symlink escape、过期、重放和撤销请求；
- MCP只接受最多32项服务端静态工具注册，模型与远端`annotations`不能改变capability、risk、effect或模型工具名；生产端点必须HTTPS，非生产HTTP仅允许loopback，URL userinfo和fragment被拒绝；
- MCP调用前分页核对远端工具及Schema，SDK HTTP响应、参数、文本和结构化输出均有大小/深度上限；图片、音频和Resource尚未建立受控物化边界，因此明确失败而不是直接进入模型；
- Bearer值只能由Credential Broker按Actor、Personal Agent、server和不透明handle解析，并仅进入当次传输头；缺Broker、缺handle或解析失败会禁用/降级，状态与异常不保存URL、参数、Token或远端正文；
- MCP L2/L3仅允许write且必须耐久审批：参数与Credential Handle使用AES-256-GCM短期密文，AAD绑定Operation/Actor/Agent/Tool Call与可信注册，明文上限256 KiB；外呼前擦除密文，过期prepared密文按有界批次擦除。Worker重领`dispatching`意图时只读取Effect Ledger，已提交则补账，未确认则`outcome_unknown`，禁止盲目重放；
- 所有入站消息、文件、语音、链接和设备结果都视为不可信输入并记录来源。

当前`EDUCANVAS_GATEWAY_BOOTSTRAP_TOKEN`是管理员/本地建联密钥，持有者可以为指定user建立Client或Node session。它至少32字节、只放Authorization header且公共transport默认关闭，但不能替代正式IdP或面向最终用户分发；生产部署前必须接入真实认证、密钥轮换、速率限制和会话撤销。

Gateway结构化日志只包含固定路由标签、状态、时延、Operation ID和事件类型；不会记录URL动态ID、正文、token、Provider Key、私有对象key或未清洗异常。内部指标端点受internal bearer保护。

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
