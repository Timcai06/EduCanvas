# 团队协作指南

这份说明只保留日常开发必须知道的内容。看不懂命令时不要硬操作，先在群里问。

## 一条基本原则

**不要直接向`main`分支提交代码。所有改动都通过分支和Pull Request进入主仓库。**

## 第一次参与

项目负责人先在GitHub仓库的`Settings -> Collaborators`中邀请队友。队友接受邀请后执行：

```bash
git clone <仓库地址>
cd <仓库目录>
```

如果没有主仓库写权限，再使用Fork方式参与。

## 每次开始新工作

先更新本地`main`：

```bash
git switch main
git pull origin main
```

再创建工作分支：

```bash
git switch -c feat/简短功能名
```

常用分支名：

- `feat/xxx`：新功能
- `fix/xxx`：修复问题
- `docs/xxx`：文档修改
- `refactor/xxx`：代码重构
- `test/xxx`：测试相关

分支名使用小写英文和短横线，例如：

```text
feat/lesson-canvas
fix/chat-stream-timeout
docs/backend-architecture
```

## 保存并上传工作

```bash
git status
git add <本次修改的文件>
git commit -m "feat: add lesson canvas"
git push -u origin feat/lesson-canvas
```

提交信息格式：

```text
feat: 新功能
fix: 修复问题
docs: 修改文档
refactor: 重构代码
test: 增加或修改测试
chore: 工具、依赖或配置调整
```

一个提交尽量只做一件事。不要使用“update”“修改一下”这类无法说明内容的提交信息。

## 创建Pull Request

推送后在GitHub创建Pull Request，目标分支选择`main`，说明：

1. 做了什么；
2. 为什么要做；
3. 怎么验证；
4. 有哪些截图、风险或未完成项；
5. 是否更新了相关文档。

合并条件：

- 自动检查通过；
- 至少一位队友完成Review；
- 没有未解决的讨论；
- 需要时已更新`doc/`；
- 合并后可以正常运行。

默认使用 **Squash and merge**，让一个PR在`main`中对应一个清晰提交。

## 如何避免冲突

- 开始任务前先在GitHub Issue或群里认领；
- 不要两个人同时大改同一个文件；
- 每天开始开发前更新`main`；
- PR保持小而清楚，尽量在1至2天内完成；
- 遇到冲突先通知相关队友，不要删除不理解的代码。

## 禁止提交

- API Key、密码、Token和私钥；
- `.env`真实配置；
- 学生真实个人信息；
- 大型模型权重、构建产物和临时缓存；
- 未确认授权的教材、图片或视频。

秘密信息放在本地`.env`或部署平台的Secret中，仓库只提交`.env.example`。

## 紧急修复

紧急问题也要从`main`创建`fix/xxx`分支并走Pull Request。除非项目负责人明确同意，否则任何人都不直接推送`main`。

