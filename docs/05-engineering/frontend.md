# 前端工程

- 状态：`accepted`

## 技术栈

- Next.js App Router；
- React；
- TypeScript严格模式；
- Tailwind CSS；
- Zod。

Radix UI/shadcn、GSAP + `@gsap/react`、TanStack Query和Zustand是后续按需求引入的候选能力，当前依赖和实现尚未接入，不应按已落地技术栈描述。

## 当前学习纵切

- `app/learn/page.tsx`作为Server Component读取匿名身份对应的公开Artifact和掌握度投影；
- 显式“开始学习”Server Action先在一个数据库事务内bootstrap Session、公开Artifact和私有判分键，成功后再写入HttpOnly Cookie；
- Client Component只持有公开Artifact、交互草稿、反馈和公开Progress DTO，不持有学生ID、session ID或判分键；
- Canvas提交经Server Action恢复可信身份和课程范围，服务端判分成功后只把公开反馈与最新Progress返回浏览器；
- 刷新页面后Progress从PostgreSQL重新读取，不依赖客户端状态恢复。

依赖使用稳定版本并锁定，不在文档中长期写死“latest”。

## 模块边界

```text
app/                  页面、布局和路由
features/chat/        AI教师对话
features/canvas/      Artifact运行时
features/course/      课程与知识地图
features/progress/    学习状态
components/ui/        自有UI组件
lib/ai/               流式消息与类型
lib/api/              后端API客户端
```

## 约束

- 默认使用Server Component，只有交互和GSAP组件使用Client Component；
- Server Component渲染过程不创建Cookie；Cookie只能在Server Action或Route Handler中于数据库bootstrap成功后写入；
- Canvas组件不接收未经校验的任意HTML；
- AI消息按结构化Parts渲染；
- 所有交互具备键盘和触控可用性；
- 低龄用户的关键操作不能只依赖文字；
- 在低端设备上验证动画和代码编辑体验。
