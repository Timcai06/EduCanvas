# @educanvas/web

## 这个包是什么

这是EduCanvas当前唯一的Web应用，使用Next.js App Router承载学生端页面、三栏学习工作台和阶段一BFF组合根。它消费`@educanvas/canvas-protocol`、`@educanvas/teaching-runtime`与`@educanvas/db`，但不应把共享协议、应用用例或数据库定义复制进应用私有目录；该边界来自[ADR-0003](../../docs/09-decisions/0003-phase1-monorepo-and-drizzle.md)。当前已接通匿名课程启动、持久化Canvas加载、Server Action提交、服务端归属校验和Progress回显；这只是匿名演示身份，不是正式用户认证。

## 核心文件导读

- `app/layout.tsx`：全站根布局、中文页面语言和默认元数据。
- `app/page.tsx`：项目首页以及进入学习工作台的入口。
- `app/learn/page.tsx`：读取匿名学习快照，并呈现课程启动页或“对话 / Canvas / 进度”三栏学习主界面。
- `app/learn/actions.ts`：匿名课程bootstrap与Canvas提交的Server Action边界，只返回公开DTO。
- `app/globals.css`：全站样式入口和Tailwind CSS加载位置。
- `features/chat/chat-panel.tsx`：AI教师对话区；后续流式对话与教学状态机从这里接入。
- `features/canvas/canvas-stage.tsx`：渲染数据库加载的公开Artifact，提交受控交互并显示服务端反馈。
- `features/learning/`：Canvas与Progress的客户端协调边界及公开DTO契约。
- `features/progress/progress-panel.tsx`：展示服务端可信掌握度投影和复习时间。
- `server/anonymous-identity.ts`：生成并严格校验32-byte base64url bearer，以SHA-256哈希派生数据库学生标识，并管理HttpOnly Cookie。
- `server/learning-session.ts`：匿名课程范围、持久化快照读取、归属恢复和判分应用服务编排。
- `server/teaching-runtime.ts`：服务端组合根，向教学应用服务注入Drizzle适配器；不得从Client Component导入。
- `next.config.ts`：声明需要由Next.js转译的workspace源码包。
- `eslint.config.mjs`：Web应用的Next.js与TypeScript静态检查规则。
- `tsconfig.json`：Web应用的DOM、JSX、路径别名与Next.js类型配置。

## 常用命令

以下命令都从仓库根目录执行：

```bash
pnpm --filter @educanvas/web dev        # 启动Next.js开发服务器
pnpm --filter @educanvas/web typecheck  # 只检查Web应用的TypeScript类型
pnpm --filter @educanvas/web lint       # 只检查Web应用的ESLint规则
pnpm --filter @educanvas/web build      # 生成生产构建
```

需要同时启动所有拥有`dev`脚本的workspace时使用`pnpm dev`。学习纵切依赖PostgreSQL，启动前执行`pnpm db:up`、`pnpm db:migrate`并准备本地`.env`。浏览器验证从仓库根目录执行：

```bash
E2E_DATABASE_URL=postgresql://educanvas:educanvas@localhost:5432/educanvas_e2e pnpm test:e2e
```

该命令拒绝连接数据库名不以`_e2e`或`_test`结尾的实例，并会先构建生产应用。

## 改动前必读的 docs/ 文档

- [产品定义](../../docs/01-product/product-definition.md)：确认页面服务的用户与核心产品形态。
- [用户流程](../../docs/01-product/user-flows.md)：确认页面处于哪一段学习流程。
- [Canvas与GSAP](../../docs/02-architecture/canvas-and-gsap.md)：修改Canvas或动画前必读。
- [前端工程](../../docs/05-engineering/frontend.md)：遵守组件边界、Server/Client Component和可访问性要求。
- [API约定](../../docs/05-engineering/api-conventions.md)：新增Route Handler或流式接口前必读。
- [ADR-0003](../../docs/09-decisions/0003-phase1-monorepo-and-drizzle.md)：理解阶段一为什么暂由Next.js交付。
