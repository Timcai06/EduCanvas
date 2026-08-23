# EduCanvas — Claude Code instructions

先完整阅读并遵守仓库根目录的 [AGENTS.md](AGENTS.md)。它是 EduCanvas 的唯一通用规则来源，包含仓库地图、架构边界、Git/PR 交付、验证与文档义务；本文件不复制这些规则。

Claude Code 的补充要求：

- 面向项目维护者的解释与文档优先使用中文；代码标识符、package 名和已确立的工程术语保留英文。
- 涉及产品视觉或交互时，先检查实际页面、设计资产和现有组件；不要以抽象设计模式替代项目既有交互约束。
- 需要运行本地服务或外部 Provider 时，明确区分静态检查、本地运行证据、live/external proof 和人工验收，不将其中任一项混称为 production readiness。
