# 前端工程

- 状态：`accepted`

## 技术栈

- Next.js App Router；
- React；
- TypeScript严格模式；
- Tailwind CSS；
- Radix UI + 可修改的shadcn/ui组件；
- GSAP + `@gsap/react`；
- TanStack Query；
- Zustand；
- Zod。

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
- Canvas组件不接收未经校验的任意HTML；
- AI消息按结构化Parts渲染；
- 所有交互具备键盘和触控可用性；
- 低龄用户的关键操作不能只依赖文字；
- 在低端设备上验证动画和代码编辑体验。

