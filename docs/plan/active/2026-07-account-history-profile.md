# 2026-07 账号、历史记录删除与用户资料规格

状态：draft

## 目标

为 EduCanvas Web 增加最小可用的账号体系和个人资料能力，让用户可以：

- 注册账号并登录。
- 使用最少 6 位密码，并在输入时看到 3 档密码风险等级。
- 删除自己的历史记录。
- 上传自己的头像。
- 修改自己的昵称。
- 修改自己的密码。

本规格优先解决本地产品体验和用户数据归属，不引入第三方 OAuth、邮箱验证、短信验证或管理员后台。

## 当前项目事实

- Web 当前主要通过 `readAnonymousIdentity()` 读取匿名或本地主体。
- `platform_users` 已存在，区分 `registered` 与 `anonymous_compat` 主体。
- `personal_agents` 已存在，当前模型是一位自然人一个 Personal Agent。
- 通用聊天历史在 `conversations` 与 `conversation_messages` 中。
- `conversations.status` 已支持 `active` / `archived`，适合实现历史记录软删除。
- 文件上传已有本地对象存储边界，可复用头像上传的存储思路，但头像必须单独限制类型、大小和公开访问方式。

## 功能范围

### 1. 注册

用户可通过 Web 表单注册账号。

首版账号标识使用 `username`，不使用邮箱验证。原因是当前项目没有邮件服务和外部 IdP，用户名方案更适合本地最小闭环。

注册字段：

- 用户名：3 到 32 位；只允许字母、数字、下划线、短横线。
- 昵称：1 到 30 个字符；允许中文。
- 密码：最少 6 位。

注册成功后：

- 创建 `platform_users` 记录，`kind = registered`。
- 创建对应 `personal_agents`。
- 创建用户资料记录。
- 写入 HttpOnly session cookie。
- 跳转回首页。

### 2. 登录 / 退出

用户可通过用户名和密码登录。

登录成功后：

- 写入 HttpOnly session cookie。
- Web 后续请求优先使用登录用户身份。

退出登录后：

- 清除登录 session cookie。
- 不删除历史记录。
- 用户可继续作为匿名用户开始新会话。

### 3. 密码风险等级

密码最少 6 位。低于 6 位时不能提交。

UI 显示 3 档风险等级：

- 高风险：长度 6 到 7，或只有一种字符类型。
- 中风险：长度 8 到 11，且包含两种字符类型。
- 低风险：长度至少 12，且包含三种或更多字符类型。

字符类型包括：

- 小写字母
- 大写字母
- 数字
- 符号

服务端必须重新校验密码最少 6 位；前端强度提示只用于体验，不能作为安全边界。

密码存储：

- 不保存明文密码。
- 使用 Node.js 内置 `crypto.scrypt` 派生密码哈希，保存算法、盐、参数和哈希。
- 登录时使用 timing-safe 比较。

### 4. 历史记录删除

用户可以删除自己的历史记录项。

首版删除语义：

- 对通用聊天 `conversation` 执行软删除。
- 将 `conversations.status` 改为 `archived`。
- 写入 `archived_at`。
- 不物理删除 `conversation_messages`、assets 或 artifacts。

原因：

- 当前 schema 已有 active/archived 生命周期。
- 软删除误删风险低。
- 不会破坏已有外键、审计和恢复链路。

删除成功后：

- 该历史记录不再出现在侧边栏。
- 如果删除的是当前打开会话，应自动切换到最近的其他 active 会话；如果没有其他会话，则显示空状态或新建入口。
- 用户不能删除不属于自己的会话；越权与不存在统一处理为 404 或静默失败。

### 5. 昵称修改

用户可以在设置页修改昵称。

昵称规则：

- 1 到 30 个 Unicode 字符。
- 去掉首尾空白。
- 不允许控制字符。

修改后：

- 设置页立即显示新昵称。
- 顶部用户入口显示新昵称。

### 6. 头像上传

用户可以上传自己的头像。

头像规则：

- 仅支持 PNG、JPEG、WebP。
- 最大 2MB。
- 服务端读取 magic bytes 判断类型，不能只信任浏览器 `Content-Type`。
- 保存到对象存储。
- 用户资料表只保存头像对象 key、mime type 和更新时间。

首版不做服务端裁剪。前端可用 CSS 将头像显示为圆形。

### 7. 匿名历史迁移策略

首版默认不自动迁移匿名历史到注册账号。

原因：

- 自动迁移涉及安全确认：必须证明匿名 cookie 与新账号是同一浏览器主体。
- 如果直接合并，容易把公共电脑上的匿名历史错误绑定到新用户。

后续可单独做“注册后询问是否导入当前匿名历史”的 PR。

### 8. 修改密码

登录用户可在设置页输入当前密码、新密码与确认密码来更新密码。

- 服务端重新验证当前密码，并对新密码执行最少 6 位校验。
- 更新成功后撤销该账号所有旧 session，再为当前浏览器签发一个新 session。
- 这让当前用户无需再次登录，同时其他设备必须用新密码登录。

## 技术方案

### 数据库

新增表：

- `web_user_credentials`
  - `user_id`
  - `username_normalized`
  - `password_hash`
  - `password_salt`
  - `password_params`
  - `created_at`
  - `updated_at`

- `web_user_profiles`
  - `user_id`
  - `nickname`
  - `avatar_object_key`
  - `avatar_mime_type`
  - `created_at`
  - `updated_at`

- `web_sessions`
  - `id`
  - `user_id`
  - `token_hash`
  - `created_at`
  - `last_seen_at`
  - `expires_at`
  - `revoked_at`

不修改 `platform_users.id` 的语义；注册用户 ID 由服务端生成，例如 `user:<uuid>`。

### Web 服务端

新增模块建议：

- `apps/web/server/auth/password.ts`
- `apps/web/server/auth/session.ts`
- `apps/web/server/auth/account-repository.ts`
- `apps/web/server/auth/current-user.ts`
- `apps/web/server/profile/profile-repository.ts`

身份读取顺序：

1. 如果存在有效登录 session，返回注册用户身份。
2. 否则回退到当前匿名身份逻辑。

### Web 路由 / Action

新增或调整：

- `/register`
- `/login`
- `/settings/profile`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/me`
- `PATCH /api/v1/me/profile`
- `POST /api/v1/me/avatar`
- `DELETE /api/v1/chat/conversations/[conversationId]`

### 前端

新增 UI：

- 首页或 header 中显示登录 / 注册入口。
- 登录后显示头像和昵称入口。
- 设置页增加个人资料区。
- 侧边栏历史记录项增加删除按钮。
- 注册表单增加密码风险等级提示。

## 验证命令

本功能完成后至少运行：

```bash
pnpm lint
pnpm typecheck
pnpm --filter @educanvas/web test
pnpm test:unit
```

如果修改数据库 schema 和迁移，还需要运行：

```bash
pnpm db:generate
pnpm --filter @educanvas/db test
```

如果 UI 变化明显，补充 Playwright 或手动浏览器验证。

## 测试策略

必须增加测试：

- 密码强度分级测试。
- 密码 hash / verify 测试。
- 注册重复用户名测试。
- 登录错误密码测试。
- session cookie 读取和过期测试。
- 删除他人历史记录失败测试。
- 删除自己的历史记录后不再出现在列表测试。
- 头像上传类型和大小限制测试。
- 昵称规范化测试。

## 边界

Always：

- 所有写操作检查同源。
- 所有 API 输入做 schema 校验。
- 密码永不明文保存。
- session cookie 使用 HttpOnly、SameSite=Lax，生产环境 Secure。
- 用户只能修改/删除自己的数据。
- 删除历史记录首版使用软删除。

Ask first：

- 是否自动迁移匿名历史。
- 是否使用邮箱代替用户名。
- 是否引入第三方认证库。
- 是否物理删除历史记录及关联资产。
- 是否把头像做公开 URL 或受控读取 route。

Never：

- 不把密码、session token、头像对象 key 直接暴露给浏览器。
- 不在 localStorage 存认证 token。
- 不让浏览器声明 `userId`。
- 不为了删除 UI 直接 cascade 删除整套业务数据。

## 验收标准

- 未登录用户仍可按当前匿名体验开始使用。
- 用户可以注册、登录、退出。
- 密码少于 6 位无法注册。
- 注册页显示 3 档密码风险等级。
- 登录后 header 或设置页能看到昵称和头像。
- 用户能修改昵称。
- 用户能上传头像，非法类型或超大文件会失败。
- 用户能删除自己的历史记录。
- 删除后的历史记录不会再出现在侧边栏。
- 不能删除其他用户的历史记录。
- 全部相关测试通过。

## 待确认问题

1. 首版账号标识是否接受使用用户名，而不是邮箱？
2. 注册后是否需要把当前匿名历史迁移到新账号？本规格默认不迁移。
3. 删除历史记录是否接受“软删除/归档”？本规格默认软删除。
4. 头像是否只需要本地显示，不要求公开分享链接？本规格默认通过受控 route 读取。
