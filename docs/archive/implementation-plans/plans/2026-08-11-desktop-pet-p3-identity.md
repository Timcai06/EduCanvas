# 桌宠远端身份与 Gateway Client（P3）实现计划

> 日期：2026-08-11
> 分支：`feat/20260811-desktop-p3-identity`
> 基线：P2 `773e845`
> 依据：ADR-0024、桌宠模块设计、RFC 8252 / RFC 7636、Electron 43 官方文档

## 目标

把桌宠从依赖 localhost 匿名回退的壳升级为可撤销的第一方远端 Client：

```text
桌宠点击登录
  -> main 生成 state + PKCE verifier/challenge
  -> 系统浏览器打开 EduCanvas 授权页
  -> 已登录用户确认授权
  -> Web 校验并绑定该用户当前 Conversation / Notebook
  -> educanvas://auth/callback?code=...&state=...
  -> main 校验回调与 state，以 code + verifier 换 Client session
  -> OS safeStorage 加密落盘
  -> Gateway bearer 提交 Turn / 读取 Event / 取消
```

回调 URL 只出现一次性短期 `code` 与 `state`。Client bearer 不进入 URL、Renderer、
日志或 Provider 边界，并可由服务端撤销。

## 范围与非目标

P3 包含：

- 系统浏览器授权、S256 PKCE、一次性 code、防重放 exchange；
- `educanvas://auth/callback` 打包协议，macOS `open-url`、Windows 单实例参数与冷启动；
- 独立前缀的可撤销桌面 Client session，复用现有 `web_sessions` hash/expiry/revokedAt
  能力，不新增 Schema/Migration；
- Electron `safeStorage` 异步加解密、原子凭据文件写入与损坏失败关闭；
- `assistant-proxy` 改走 `gateway.v1`，消费 canonical Operation Event；
- 授权时绑定 Web 当前 Conversation / Notebook，后续 Turn 不再按目录顺序猜测会话；
- ASR/TTS Web BFF 接受同一桌面 bearer，使 P2 语音链在远端身份下可用；
- 现有气泡中的登录、授权中、成功、失败与重试反馈。

P3 不包含：

- 外部社交 IdP、refresh token 或监护人体系；
- Web/Canvas handoff（P4）；
- 新表、新 Migration、第二 Agent Runtime 或桌宠消息账本；
- macOS 签名、公证与双平台发行制品（P5）；macOS deep link 最终验收仍必须使用打包应用。

## 安全与数据契约

### 原生授权

- 固定 `client_id=educanvas-desktop`、`redirect_uri=educanvas://auth/callback`；
- `state` 与 `code_verifier` 均由 32 字节 CSPRNG 生成，只保存在 Electron main 内存；
- 只接受 `S256`；授权页拒绝任意 client、redirect、challenge 或超长参数；
- authorization code 为带 HMAC 的短期 credential，payload 只含 PKCE challenge、
  nonce、expiry 与已经过所有权校验的 Notebook / Conversation 路由，不含 user id；
  数据库只保存完整 code 的 SHA-256 hash；
- exchange 先验证格式、签名、过期与 PKCE，再原子消费记录；重放统一失败；
- Client token 使用 `ecs1_` 前缀，Web Cookie parser 无法接受；Gateway 仅在该前缀
  下查询 hash session，现有 bootstrap HMAC 会话保持兼容。

### 持久化与撤销

复用 `web_sessions` 的 `token_hash / expires_at / revoked_at` 生命周期，不改变 schema。
authorization code 是约 2 分钟且首次兑换即 revoked 的记录；桌面 session 是独立格式、
最长 30 天的记录。Gateway 每次请求都重新查询活动 session，因此撤销立即生效。

Electron 只把 `{token, expiresAt, userId, notebookId, conversationId, webBaseUrl,
gatewayBaseUrl}` 的严格 JSON 经 `safeStorage.encryptStringAsync` 加密后写入 userData。
无法加密、解密失败、内容非法或过期时均视为未登录，不降级为明文。

### 单一 Agent 会话不变量

- **同一主体**：Web session 在授权时解析注册用户，桌面 bearer 只恢复这个 user id；
- **同一路由**：授权时读取 Web 的活动 Conversation / Notebook，签名进一次性 code，
  token grant 与加密桌面 session 固化这组绑定；目录排序变化不会让桌宠漂移；
- **同一 Runtime**：桌宠 Turn 进入现有 `GatewayService -> GatewayTurnRunnerPort`，不建
  第二 Agent loop；route resolver 每次按 user + Notebook + Conversation 复核成员权限；
- **同一上下文能力**：Memory、RAG、Tools、Citation、Artifact 等继续由同一个
  Conversation 的 Agent Profile 和服务端 Turn/Operation 管线继承；桌宠不维护副本；
- **同一 Operation**：文本输入和语音转写后的文本都只提交一次 Gateway Turn，取消
  作用于该 Operation；TTS 朗读该 Turn 的输出，不另起隐藏 Turn。

桌宠是轻量入口而不是第二套聊天 UI：核心负责文本/语音输入、响应与 TTS；完整历史、
文件上传、Citation/Artifact 细节、Canvas、Slides/思维导图留在 Web 展示，桌宠只做
简化提示或后续 handoff。

### 进程边界

- Web 浏览器 Cookie 只进入 Web 授权页；
- code/state 只进入系统浏览器地址与 main；
- Client bearer 只存在 Web token exchange 响应、Electron main 安全存储、
  Gateway/Voice BFF `Authorization` header；
- preload 仅暴露 `status / signIn / signOut` 和稳定结果，Renderer 不接触 token、
  verifier、code 或远端内部错误。

## 测试驱动任务

### Task 1：共享原生 Client 契约与 DB 生命周期

1. 先写 client/query/callback/exchange/session token 严格 schema 测试；
2. 实现 `gateway-core` 原生客户端常量与 schema；
3. 先写桌面授权 code 单元测试：签名、过期、篡改、PKCE；
4. 先写 DB 集成测试：一次性消费、重放、过期、撤销、inactive user；
5. 实现复用 `web_sessions` 的桌面 credential repository，不新增 migration。

### Task 2：Web 授权与 exchange

1. 先写授权 route/page 的未登录、非法参数、同源、确认与 deep-link redirect 测试；
2. 实现授权页：沿用“两支笔”设计 token，未登录时复用现有 `AuthForm` 并原地恢复；
3. 先写 token endpoint 的配置缺失、错误 verifier、重放、成功测试；
4. 实现短期 code 签发/消费与 Client session grant；
5. 增加请求级桌面 bearer 解析，语音 route 继续拒绝匿名且不接受 bearer 作为 Cookie。

### Task 3：Gateway 可撤销 session

1. 先写 Gateway route 测试：活动桌面 token 可访问、撤销后 401、Web Cookie/HMAC
   格式不混用、原有 bootstrap 会话不回归；
2. 在 Client transport 注入桌面 session resolver；
3. 增加 `POST /v1/client/session/revoke` 与桌面 session revoke client；
4. 保持主体仍由 `getActive(userId)` 二次校验，Turn 仍进入唯一 Agent Runtime。

### Task 4：Electron main 授权与系统安全存储

1. 先写 PKCE、授权 URL、严格 callback、过期 pending state 测试；
2. 先写加密存储的成功、损坏、过期、不可加密、密钥轮换测试；
3. 实现 auth coordinator、系统浏览器、exchange、状态事件与登出撤销；
4. 按 Electron 官方模式注册协议：macOS `open-url`，Windows/Linux
   `second-instance`，并处理 Windows 冷启动 argv；
5. 在 electron-builder 声明 `educanvas` protocol；开发态仅做契约测试，不把它当
   macOS 打包验收证据。

### Task 5：远端 assistant / voice 与最小 Renderer 接线

1. 先改 assistant proxy 测试，要求 Authorization header、授权绑定的 conversation、
   NDJSON delta 聚合、终态/401/取消映射；
2. 复用 `GatewayClient` 提交 Turn 和取消 Operation，不再调用
   `/api/v1/assistant/turn` 或 `local:owner`；
3. 先改 voice proxy 测试，要求 bearer 且凭据缺失时稳定失败；
4. 现有角色按钮在未登录时打开授权，气泡通过既有 live region 播报状态；
5. 身份失效时清除本地密文并回到可重试登录，不改桌宠窗口、sprite 或布局。

### Task 6：验证

- gateway-core / db / web / gateway / gateway-client / desktop 目标测试；
- 受影响 workspace typecheck、lint、Prettier、desktop build、file governance；
- Windows 开发包：冷/热 deep link、state 篡改、code 重放、登录、语音问答、取消、
  登出与撤销；
- 安全审计：无 token URL/body/log/Renderer，无明文凭据，无新 Schema/Migration，
  无 localhost 身份回退，无第二 Agent loop；
- macOS `open-url` 代码与配置可构建；实际打包回跳列为 P5/目标机器验收。

## 官方实现依据

- Electron Deep Links：<https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app>
- Electron `safeStorage`：<https://www.electronjs.org/docs/latest/api/safe-storage>
- Electron `shell.openExternal`：<https://www.electronjs.org/docs/latest/api/shell>
- OAuth 2.0 for Native Apps（RFC 8252）：<https://www.rfc-editor.org/rfc/rfc8252>
- PKCE（RFC 7636）：<https://www.rfc-editor.org/rfc/rfc7636>
