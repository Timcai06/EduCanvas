# 前端工程

- 状态：`accepted`

## 技术栈

- Next.js App Router；
- React；
- TypeScript严格模式；
- Tailwind CSS；
- Zod；
- GSAP + `@gsap/react`（用于空对话、Canvas面板、Sheet的UI状态动效，以及受控`pipeline_flow`教学Timeline）。

Radix UI/shadcn、TanStack Query和Zustand是后续按需求引入的候选能力，当前不应按已落地技术栈描述。`pipeline_flow`和`AnimationShell`已经实现首个受控模板与播放协议；它是静态React注册表，不是模型可写的动画DSL。

## 当前学习纵切

- `app/learn/page.tsx`作为Server Component读取匿名身份对应的公开Artifact和掌握度投影；
- 显式“开始学习”Server Action先在一个数据库事务内bootstrap Session、公开Artifact和私有判分键，成功后再写入HttpOnly Cookie；
- 首次访问和已有匿名会话都从深色S0 Chat-empty进入；首条消息后由`LearnWorkspace`切到S1 Chat-only，Canvas按需进入S2 Chat + Canvas；
- S0 的 quiet 顶栏只显示品牌，不能提前显示课程阶段、Progress 或 Studio。阶段投影接入前不渲染硬编码状态；
- 消息类型、SSE事件解析和浏览器Turn状态机位于`features/chat/`：固定`POST /api/v1/learn/turn`、只消费版本化EduCanvas事件，支持真实Stop、内联重试和刷新消息恢复；正常学习页不导入`features/chat/demo-teacher-script.ts`；
- 桌面Learning Rail默认折叠，移动端为模态Sheet；它只渲染Server Component传入的真实会话摘要，搜索、分页、新建和恢复能力通过回调注入，不在浏览器硬编码“最近对话”；
- `+`菜单只有现存预置互动可执行，未接入能力使用原生`disabled`并跳过roving focus；课程资料目录不可选择，Studio明确区分“本课预置”与未来AI生成；
- Client Component只持有公开Artifact、消息/会话摘要、交互草稿、反馈和公开Progress DTO，不持有学生ID、数据库归属字段、lease或判分键；
- Canvas提交经Server Action恢复可信身份和课程范围，服务端判分成功后只把公开反馈与最新Progress返回浏览器；
- 刷新页面后消息终态、会话摘要与Progress从PostgreSQL重新读取，不依赖客户端缓存恢复。

前端Demo Script已经退出正常运行时依赖，只允许保留在测试、Fixture或明确标识的离线Demo模式，且不可被描述为模型降级回答。无Provider时必须显示诚实的不可用状态。

依赖使用稳定版本并锁定，不在文档中长期写死“latest”。

## 模块边界

```text
app/                  页面、布局和路由
features/chat/        AI教师对话
features/canvas/      Artifact运行时
features/course/      课程与知识地图
features/progress/    学习状态
components/ui/        自有UI组件
server/               学习会话查询与服务端组合
```

`features/chat/turn-events.ts`是浏览器可见的SSE边界，`turn-state.ts`是纯状态机，`use-teaching-turn.ts`只负责固定Route、取消和AbortController生命周期。三者不得解析供应商事件、模型ID或原始异常。

## 约束

- 默认使用Server Component，只有交互和GSAP组件使用Client Component；
- Server Component渲染过程不创建Cookie；Cookie只能在Server Action或Route Handler中于数据库bootstrap成功后写入；
- Canvas组件不接收未经校验的任意HTML；
- `pipeline_flow`只接收注册语义槽位与教学文案，Renderer固定DOM/属性/时长；render-only投影与可判分`prepareArtifact()`路径分离；
- AI消息按结构化Parts渲染；
- Turn SSE 已知事件严格校验`schemaVersion/type`和字段上限，未知新增事件可安全忽略；响应帧、未分帧buffer、事件数与累计文本都有客户端上限；
- 对话自动滚动只在距离底部阈值内或学生刚发送时执行；`aria-live`只播报Turn开始、完成和失败，不随delta更新；
- 所有交互具备键盘和触控可用性；
- 移动/全屏Canvas和Sheet使用`dialog`、背景`inert`、焦点循环和焦点归还；桌面分栏Canvas保持`region`，可拖拽分隔条暴露完整ARIA数值；
- 装饰性GSAP只动画transform/opacity，静态blur/gradient不进入Timeline；无限Timeline必须响应页面visibility和reduced-motion；
- 教学Timeline卸载时kill、页面hidden时暂停；reduced-motion不创建插值Timeline，键盘支持空格、方向键、Home与End；
- 低龄用户的关键操作不能只依赖文字；
- 在低端设备上验证动画和代码编辑体验。
