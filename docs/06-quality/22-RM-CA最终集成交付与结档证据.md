# RM/CA 最终集成交付与结档证据

- 日期：2026-08-13
- 状态：`PASS`（本地集成与竞赛范围）
- 基线：`49dcbe89902e57fc1753f9caa2b9514ea06f5245`
- CA 接受候选：`e3bf580a3610ca64b6b2deaf560eeaaf2ed67659`
- RM 接受候选：`ae7c82276c4d44fa2d7821947513eb5e3a4db4b5`
- Reviewer 代码候选：`908489bc186d4f28e3cffe37c6167e436aca5881`
- 原始日志：`/Users/tim/DEV/EduCanvas-coordination/evidence/integration-908489b`

## Reviewer 结论

唯一 reviewer 已分别接受 CA 与 RM 候选，并在本地集成分支解决以下共享接缝：

1. `general-workspace-layout.tsx` 同时保留 CA 的 Canvas 关闭焦点恢复与 RM 的统一资源打开入口；
2. ADR-0028 保留 CA 的 fail-closed terminal 语义；
3. Turn outcome 使用 `completed | failed | cancelled | interrupted | rejected`，只有
   `completed` 消费一次性上下文、输出偏好与附件；
4. 陈旧 PlusMenu Artifact E2E 改为当前资源工作台架构：一条真实 API/Worker/Studio/Canvas
   纵切，其余壳层与 Renderer 检查使用持久 fixture，学习路径使用当前 UI 入口。

RM00-RM09、RX01-RX03、CA00-CA05、CA07-CA09 与 CX01-CX03 在本轮范围内结档。CA06
Desktop 主链继续 `DEFERRED`，没有被自动门禁或文档写成已完成。

## 最终代码候选门禁

| 门禁                  | 结果                                                          |
| --------------------- | ------------------------------------------------------------- |
| Unit                  | Turbo 25/25；Web 213 files / 1596 tests                       |
| Typecheck             | workspace 25/25，加 E2E typecheck                             |
| PostgreSQL            | DB 51 files / 366 tests；Worker 12 files / 54 tests           |
| Migration             | fresh/N-1 17/17；58 records；无生成漂移                       |
| Browser               | Desktop Chromium 50/50                                        |
| Build                 | 8/8                                                           |
| Repository governance | 2002 tracked files；`git diff --check` 通过                   |
| Lint                  | workspace lint 4/4；根 wrapper 在 Prettier 扫描生成物时退出 1 |

根 lint 的唯一失败输入是三个被 Git 忽略的 Desktop bundle：
`apps/desktop/out/main/index.js`、`apps/desktop/out/preload/index.js` 和
`apps/desktop/out/renderer/assets/index-mMvoBMQ6.js`。这些文件没有被修改，也没有作为源码
纳入提交，因此本报告不把 root wrapper 写成全绿，但保留 package lint 通过的事实。

PostgreSQL 前两次 reviewer 命令分别使用了不存在的数据库和违反测试库后缀约束的数据库名，
属于命令设置错误；权威复跑使用隔离的 `educanvas_integration` 数据库并全绿。初始 Chromium
执行被同仓库遗留的 3100 端口进程阻断；只终止该精确进程后，完整 Desktop Chromium 50/50
通过。原始失败日志被保留，没有伪装成候选代码失败或删除证据。

## 明确未验证范围

- 按项目负责人指示，最终集成候选没有重跑移动 Chromium 与 Firefox；它们已有各自候选阶段
  证据，但不冒充集成 SHA 证据。
- Safari、真实麦克风、真实 Provider/MinerU、远端 full/nightly、真人读屏措辞、Desktop 签名
  安装与发布环境没有本轮证据。
- CA06 的 Web/Desktop 统一主链作为后续独立计划重新审计，不阻塞当前本地竞赛范围结档。

## 可追溯入口

- [CA 归档计划](../plan/completed/CA-代码与架构可信化.md)
- [RM 归档计划](../plan/completed/RM-统一资源工作台.md)
- [CA 历史基线](16-CA可信化基线.md)
- [RM 专项验收](18-RM统一资源工作台交付与验收证据.md)

本报告证明本地候选在列明范围内完成工程收口；它不证明外部 Provider、真人语音、Safari、
远端 CI 或发布环境可用，也不授权 push、PR 或远端合并。
