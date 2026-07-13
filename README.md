# 多模态K12人工智能通识课教学助手

本仓库用于开发浙江省大学生人工智能竞赛赛题 **JBGS-2026-02：多模态K12人工智能通识课教学助手对话智能体**。

项目目标：做一个面向小学到高中学生的AI教师。它能通过对话、动画、绘本、编程和游戏化练习进行教学，并根据学生的学习表现调整下一步内容。

## 从哪里开始

- 产品、架构和研发文档：[doc/README.md](doc/README.md)
- 团队协作方法：[协作.md](协作.md)
- 官方赛题：[第二届浙江省大学生人工智能竞赛赛题细则.docx](doc/00-overview/第二届浙江省大学生人工智能竞赛赛题细则.docx)

## 仓库地图

```text
EduCanvas/
├── .editorconfig             # 编辑器通用格式约定；出现缩进或换行差异时查看。
├── .env.example              # 本地环境变量模板；首次启动时复制为不提交的`.env`。
├── .gitattributes            # Git文本规范；排查跨系统换行问题时查看。
├── .github/                  # 修改CI、PR模板或Code Owner规则时查看，普通功能开发通常不用动。
├── .gitignore                # Git忽略规则；新增构建产物、缓存或本地文件类型时查看。
├── .nvmrc                    # 项目Node.js版本；本地或CI版本不一致时查看。
├── .prettierrc               # 代码格式化规则；调整全仓库排版约定时查看。
├── .vscode/                  # 使用VS Code时提供团队统一的编辑器建议和设置。
├── apps/
│   └── web/                  # Next.js学生端应用；开发页面、对话区或教学Canvas前先读这里的README。
├── packages/
│   ├── canvas-protocol/      # Canvas Artifact与学习事件的共享协议；新增教学组件或事件前必须先看。
│   └── db/                   # Drizzle表结构、数据库连接和迁移；涉及持久化数据时必须先看。
├── doc/                      # 产品、架构、AI、数据和运维的共同事实源；做方案或跨模块改动前从其README进入。
├── CLAUDE.md                 # AI agent的工作规则入口；让agent改仓库前必须先读。
├── README.md                 # 新成员的仓库入口；第一次打开项目时从这里开始。
├── 协作.md                    # 面向队友的Git/GitHub操作指南；第一次参与或准备提交PR时查看。
├── docker-compose.yml        # 本地PostgreSQL与pgvector环境；启动或排查数据库时使用。
├── package.json              # 仓库统一命令和Node/pnpm约束；不知道命令从哪里跑时查看。
├── pnpm-lock.yaml            # 精确依赖版本锁；依赖变化时由pnpm更新，不要手工编辑。
├── pnpm-workspace.yaml       # pnpm工作区范围；新增应用或共享包时需要更新。
├── turbo.json                # Turborepo任务依赖与缓存规则；调整build、lint或typecheck流程时查看。
└── tsconfig.base.json        # 全仓库TypeScript基础约束；修改编译规则时查看。
```

## 最简单的团队协作规则

1. `main`是稳定分支，不直接修改。
2. 每项工作先创建自己的分支。
3. 完成后推送分支并创建Pull Request。
4. 至少让一位队友检查后再合并。
5. 产品、接口或技术决策发生变化时，同时更新`doc/`。
