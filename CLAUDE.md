# EduCanvas — Agent 工作规则

多模态K12人工智能通识课教学助手（浙江省大学生人工智能竞赛 JBGS-2026-02）。所有产品、架构、AI、数据设计文档在 `doc/`，入口是 `doc/README.md`；面向人的协作指南是 `协作.md`。

## Git 规则（GitHub 分支保护已强制执行）

- 绝不直接 commit 或 push 到 `main`。开始任务先 `git switch main && git pull origin main`，再创建分支
- 分支命名：`feat/xxx`、`fix/xxx`、`docs/xxx`、`refactor/xxx`、`test/xxx`、`chore/xxx`，小写英文加短横线
- 提交说明格式：`类型: 做了什么`（如 `feat: add lesson canvas`）。一次提交只做一件事，禁止 "update" 这类空洞说明
- 仓库只允许 Squash merge，PR 标题会成为 main 上的提交说明，必须同样按 `类型: 做了什么` 格式写
- 所有 PR 必须经 Code Owner（@Timcai06）批准才能合并
- 禁止 force push。PR 合并后远程分支自动删除，只需清理本地分支

## 绝不提交进仓库

API Key、密码、Token、私钥、`.env` 真实配置、学生个人信息、模型权重、构建产物、临时缓存、未确认授权的教材/图片/视频。环境变量模板放 `.env.example`。

## 文档同步义务

- 改动影响产品行为、接口或数据结构时，同一个 PR 里更新 `doc/` 对应文档
- 重大技术选型变化，先在 `doc/09-decisions/` 新增 ADR（模板在 `doc/templates/`）
- 文档状态标记 draft / accepted / superseded / deprecated，只有 `accepted` 可作为实现依据
- 未确定的内容写入文档的"开放问题"一节，不要写成结论
- 协作规则或技术约定变化时，同步更新本文件（CLAUDE.md）

## 注释与文档规范

- 注释只写代码本身表达不了的“为什么”：设计意图、约束原因、失败风险和对应的`doc/`文档或ADR；禁止复述函数名、语句或循环过程
- 所有导出API必须有中文说明，至少交代调用边界、重要不变量或使用限制；Zod Schema的数量/长度上限和数据库表的类型/版本选择要说明原因
- 已有注释准确就保留，代码或文档演进后过时就立即修正；不要留下任务编号式注释代替长期设计说明
- 新增`apps/*`或`packages/*`包时必须同时添加`README.md`，包含包职责、核心文件、常用命令和改动前必读文档
- 往仓库根目录新增文件，或新增`apps/*`、`packages/*`、`doc/*`等顶层目录，必须先得到Code Owner（@Timcai06）批准
- 详细规则见`doc/08-collaboration/documentation-rules.md`；重大约束变化仍需通过`doc/09-decisions/`中的ADR记录

## 核心技术约定（详见 doc/，此处为速查）

- Web：Next.js + React + TypeScript，Headless 组件 + 自有设计系统
- 动画统一使用 GSAP：`@gsap/react` + `useGSAP()`，独立 scope，卸载时回收 Timeline，不在 SSR 阶段执行
- Canvas 是受控组件协议：模型输出结构化 Artifact，经白名单 Schema 校验后由预注册 React 组件渲染。**绝不执行模型生成的任意 HTML/JS/GSAP 源码**
- PostgreSQL 是业务事实源，pgvector 承载向量检索；Redis 只放短期状态
- 教学流程由确定性状态机约束（DIAGNOSE→EXPLAIN→DEMONSTRATE→PRACTICE→ASSESS→REMEDIATE/ADVANCE），模型只负责表达和受控工具调用
- Embedding 必须记录模型、版本、维度、指令和切块版本
- LangChain 不作为核心依赖；领域状态保存在自己的数据库，不放在 Agent 框架内部
