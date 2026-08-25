# DP11 Windows 打包与性能基线

- 状态：`IN_PROGRESS`
- 测量时间：2026-08-25
- 测量分支：`feat/20260825-dp11-windows-validation`
- 前置修复：[PR #455](https://github.com/Timcai06/EduCanvas/pull/455)
- 执行计划：[DP 桌宠统一桌面外延](../../plan/active/DP-桌宠统一桌面外延.md)

本文分别记录可复现自动化、Windows 壳层测量和仍需人工确认的业务流程。当前结论不是发布
PASS：installer 与 portable 已真实生成并可启动，但代码签名、安装/升级/卸载回归和完整
人工主流程尚未完成。

## 一、环境

| 项目             | 实测值                                               |
| ---------------- | ---------------------------------------------------- |
| 操作系统         | Windows 11 家庭中文版 x64，10.0.26100（Build 26100） |
| 处理器           | Intel Core Ultra 7 255HX，20 logical processors      |
| 内存             | 31.4 GB                                              |
| Electron         | 43.3.0                                               |
| electron-builder | 26.15.3                                              |
| Node / pnpm      | 24.18.0 / 10.33.0                                    |

## 二、分发包事实

执行 `pnpm --filter @educanvas/desktop package:windows`，同一次构建生成 x64 NSIS installer
和 portable。构建命令随后自动读取 `app.asar` 并执行最小内容审计。

| 产物                             |        字节 | SHA-256                                                            | Authenticode |
| -------------------------------- | ----------: | ------------------------------------------------------------------ | ------------ |
| `EduCanvas-助手-Setup-0.1.0.exe` | 113,980,867 | `8D0C957BFE5E3C1800973135146DB6A58ADA189BFE823B0A4C3948531F8FC5E7` | `NotSigned`  |
| `EduCanvas-助手-0.1.0.exe`       | 113,772,600 | `E36ADAE0F3C41AFDC74F03152A323864A19A5F386843F842096E817D016A1066` | `NotSigned`  |

`app.asar` 为 15,349,773 字节、22 个条目。审计确认入口文件和托盘图标存在，且没有
`node_modules`、coverage、`.turbo`、`.git`、测试结果、`.env`、桌面 Session 或
PEM/KEY/P12/PFX 文件。审计建立前的包曾错误携带 workspace coverage 与 `.turbo` 日志；
Gateway Client/Core 继续保留为架构门禁要求的运行时依赖声明，但因 main bundle 已完整内联，
打包配置明确排除重复 `node_modules` 后重新打包通过审计。

当前没有 Windows 代码签名证书。CI 会记录每个 exe 的大小、SHA-256 与签名状态，并拒绝
损坏或不可信签名；`NotSigned` 暂时保留为明确发布阻断项，不能描述成已签名版本。

## 三、启动与资源基线

测量入口：

```powershell
scripts\windows\measure-desktop-package.ps1 `
  -ExecutablePath apps\desktop\dist\win-unpacked\EduCanvas助手.exe `
  -Mode unpacked
```

脚本只接受 `apps/desktop/dist` 内的 exe，隐藏测量窗口，并只清理由本次命令启动且创建时间
匹配的进程树；输出 `educanvas.desktop.windows-performance.v1` JSON，不读取 Session、消息、
Token、Provider 响应或学生内容。

| 场景                       |  窗口就绪 | 进程 |  隐藏空闲 CPU |    工作集 |  私有内存 |
| -------------------------- | --------: | ---: | ------------: | --------: | --------: |
| 解包应用，新构建首次运行   |  4,598 ms |    4 | 0.04%（2 秒） | 481.5 MiB | 332.3 MiB |
| 解包应用，同二进制再次运行 |    619 ms |    4 | 0.23%（1 秒） | 487.3 MiB | 342.8 MiB |
| portable，新构建首次运行   | 11,482 ms |    5 | 0.14%（5 秒） | 500.3 MiB | 345.5 MiB |
| portable，同二进制再次运行 |  7,153 ms |    5 | 0.16%（1 秒） | 489.5 MiB | 331.4 MiB |

首次建立 electron-builder/NSIS/安全扫描缓存时曾观察到 portable 21,328 ms；该值保留为
工具与系统缓存完全冷启动上界，不与普通重复启动混为一类。`readyMilliseconds` 表示进程
创建到桌宠原生窗口句柄出现，不代表已登录后的 canonical 历史完成或首个模型 delta。

本次重打包还在隐藏窗口上执行了原生尺寸探针：请求 900×700 后被边界限制为 760×520，
再调整为 640×360 后，`pet-window.json` 以 v3 写入同一尺寸；停止精确进程树并冷重启后，
内容尺寸恢复为 640×360（Win32 外框读数 642×362）。这只证明单屏 150% 缩放环境下的
尺寸边界和持久化，不替代第五节列出的多 DPI、多屏人工回归。

基于本机事实先冻结保守预算；签名与 installer 实测后可以收紧，但不得无测量放宽：

| 指标                        | DP11 暂定预算 |
| --------------------------- | ------------: |
| 解包/安装版同二进制重复启动 |    ≤ 2,000 ms |
| 解包/安装版新构建首次启动   |   ≤ 10,000 ms |
| portable 重复启动           |   ≤ 12,000 ms |
| portable 完全冷启动         |   ≤ 25,000 ms |
| 隐藏空闲 CPU（5 秒样本）    |          ≤ 1% |
| 常驻总工作集                |     ≤ 600 MiB |
| 单个 Windows 分发 exe       |     ≤ 130 MiB |

首屏 canonical 历史、首 delta、真实 ASR 与真实 TTS 延迟必须在登录和真人主流程中单独记录，
当前没有样本，不补造数值。

## 四、自动化门禁

- Desktop 变化把 `desktop-build` CI lane 路由到 `windows-latest`；
- Windows runner 执行 Desktop test、typecheck 和真实 installer + portable 打包；
- CI 校验 main/preload/renderer、两个非空 exe、SHA-256 和 Authenticode 状态；
- CI 上传两个 exe 作为 7 天短期诊断 artifact，不提交构建产物到仓库；
- `windows-package-config.test.ts` 冻结 x64 双产物、`educanvas://`、单实例、NSIS 卸载数据边界、
  Windows CI 和性能脚本进程所有权；
- `audit-windows-package.mjs` 对最小 ASAR 内容 fail closed。
- package policy 的仓库虚拟路径统一为 POSIX 形式；Windows 定向 package-policy 测试 8/8
  通过，不再因反斜杠误判 Provider/DB 所有权或绕过跨包相对路径检查。完整
  `pnpm test:tooling` 在 Windows 上仍会停留于既有 `local-orchestrator` 长驻用例，未计为通过。

## 五、人工与外部条件矩阵

以下项目仍为 `PENDING`，不能由单元测试、隐藏窗口脚本或开发态 Electron 替代：

- [ ] installer 交互安装、同版本覆盖、升级和卸载；确认不误删 Session 或仓库外文件；
- [ ] `educanvas://` 冷启动与已运行单实例回跳；
- [ ] 登录、Conversation 切换/新建、重启历史恢复、文本真实流式与 Stop；
- [ ] 真人中文麦克风、真实 ASR/TTS、停止与原 Assistant Message 重播；
- [ ] Citation、Artifact、精确 handoff 和真实图片/PDF上传；
- [ ] 100%/125%/150%/200% 缩放、多屏插拔、休眠恢复、托盘长驻；
- [ ] 闪烁、透明穿透、折叠、拖动和独立聊天窗口；
- [ ] 受信 Windows 代码签名与 SmartScreen 分发体验。

在上述人工项和代码签名完成前，DP11 保持 `IN_PROGRESS`，不得标为 `PASS`。
