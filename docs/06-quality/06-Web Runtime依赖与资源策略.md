# 持久 Web Runtime 依赖与资源策略

- 状态：`proposed`
- 日期：2026-07-29
- 适用范围：U11 的 package-private 守卫；尚未接入任何 Runtime Adapter

## 当前事实与边界

`CanvasResource.runtime.kind = web_sandbox` 只给出协议绝对上界：时长 300,000 ms、输出 5 MiB。它不是已测量的运行隔离保证。U11 在 `packages/canvas-protocol/src/web-runtime-policy.ts` 固化更小的启动前门禁；该文件未从 `@educanvas/canvas-protocol` 公共入口导出，U12 必须显式接入后才会影响运行行为。

当前 `apps/web/features/canvas/sandbox-preview.ts` 仍是一次性预览，不是本策略的持久运行实现。U11 不实现 iframe、消息桥、队列或终态持久化。

## 第一版依赖白名单

仅允许精确 `name + version`，不接受范围、tag、URL、远程 CDN 或运行时安装。版本来自 2026-07-29 的 `pnpm-lock.yaml` importer 锁定记录；React、GSAP 与 Three 有 `apps/web` 产品源码导入，React DOM 的直接仓库导入证据目前只在测试：

| 依赖        | 精确版本  | 产品用途事实                                               |
| ----------- | --------- | ---------------------------------------------------------- |
| `react`     | `19.2.7`  | Next.js 页面与组件运行时                                   |
| `react-dom` | `19.2.7`  | Web 框架渲染依赖；直接仓库导入证据目前在服务端静态渲染测试 |
| `gsap`      | `3.15.0`  | 第一方动画与 Canvas/UI 动效                                |
| `three`     | `0.185.1` | 第一方 WebGL 视觉组件                                      |

白名单不等于这些包已经被持久 Runtime 使用；它只使未来 Adapter 有一个可审计、锁定的候选集合。新增包或变更版本必须先更新 lockfile、产品用途证据、策略及复审测试。

## 资源上限与依据

| 项目     |     固定值 | 依据                                                              |
| -------- | ---------: | ----------------------------------------------------------------- |
| 输入     |    512 KiB | 小于协议输出绝对上界，限制启动前 Artifact 负载。                  |
| 单条消息 |     64 KiB | 限制 Host/Sandbox 桥的单次反序列化与事件放大面。                  |
| 输出     |      1 MiB | 小于 `CanvasResource` 的 5 MiB 绝对上界，留出聚合和失败处理余量。 |
| 时长     |  30,000 ms | 小于协议 300,000 ms 绝对上界，适合短交互并便于 U12 超时回收。     |
| 并发实例 |          2 | 每个策略消费者的保守浏览器负载起点，尚非容量结论。                |
| 队列深度 |          8 | 限制等待任务累积；满队列应被拒绝而不是无限等待。                  |
| 消息速率 | 每秒 30 条 | 为 R10 提供可执行的事件洪泛阈值；U12 需在实际桥上实施。           |

这些值是守卫阈值，不是 CPU 或内存硬配额。相同浏览器进程中的 iframe 不能提供可先验宣称的硬 CPU/内存隔离。

## CSP、网络与 iframe

网络固定为 `none`。CSP 固定禁止 `default-src`、`connect-src`、`frame-src`、`child-src`、`form-action`、`base-uri`、`object-src`、`worker-src` 和 `manifest-src`，因此没有 fetch、WebSocket、EventSource、远程模块、嵌套 frame、表单、base URL、插件对象、后台 Worker 或 Web App Manifest 通道。后两项即使已受 `default-src` 兜底仍显式写出，避免 U12 接入时误开放后台执行或 manifest。

iframe sandbox 只能为 `allow-scripts`，不允许 `allow-same-origin`、表单、弹窗、下载或导航权限。CSP 的最小例外如下：

- `script-src 'unsafe-inline' blob:`：仅为自包含 `srcdoc` 启动代码及经未来受控打包产生的 blob 模块预留；不允许网络 scheme。U12 应以 hash/nonce 替代 `unsafe-inline`，若其运行模型允许。
- `style-src 'unsafe-inline'`：允许自包含应用样式；不允许远程 stylesheet。
- `img-src data: blob:`、`font-src data:`、`media-src data: blob:`：只允许已在受限文档内提供的数据或受控 blob，不允许远程资源。

此策略不保证浏览器漏洞、死循环或内存压力不会影响宿主。它不授予 Cookie、Credential、宿主存储、文件系统或跨 Notebook 数据读取能力。

## U12 门槛与回退

U12 接入前必须：将 validator 放在 Runtime 启动前与消息聚合处；实测 R01、R03-R04、R10、R13-R14、R21-R22；在浏览器中验证网络观察端为零，并测试不合作死循环和内存压力时宿主仍可响应且实例可销毁；验证超限进入 U10 定义的稳定失败语义而不回显输入。

若上述浏览器隔离、销毁或容量验证失败，停止接入并保持当前一次性预览；回退到可终止 Worker、独立 origin/process 或 ADR-0019 的独立服务方案。不得将本策略测试或 happy-path smoke 解释为生产就绪或硬隔离证明。
