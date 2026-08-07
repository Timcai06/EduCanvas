# Web 工作面状态、Canvas 渲染与前端边界收敛

- 任务分配名：`W 工作面画布`
- 状态：`active`
- 负责人：hzlgou
- 实现执行：协作 Agent，每次只领取一个原子任务
- 代码审核与最终验收：Codex
- 最后验证时间：2026-08-07
- 当前领取任务：`W04-4`
- 并行计划：[R 运行时收敛](../completed/R-运行时事实收敛.md)、[Q 质量观测成本](Q-质量观测成本.md)
- 后续出口：[G 产品发布闭环](G-产品发布闭环.md)
- 关联计划：[UV 画布语音](UV-画布语音.md)

## 一、目标

本线把当前 Web 从“功能完整但由一个巨大 Workspace 手工协调多个状态”收敛为：

> 显式状态模型 + 单一资源打开语义 + 真实统一的 Canvas Renderer + 诚实失败 +
> 可静态检查的模块边界。

阶段结束后必须验证：

1. `GeneralChatWorkspace` 不再同时承担聊天控制器、Studio、Source、Artifact、Canvas、
   HTML Preview、Sidebar、Session 恢复和动画编排；
2. Source、Artifact、HTML/Runtime 预览通过一个显式 `WorkspaceSurface` 状态模型互斥；
3. Artifact 不再通过 Registry 的 compatibility renderer 再跳回旧 `ArtifactCanvas`；
4. 加载失败、权限失败和能力不可用不会被转换为空数组、空页面或“没有内容”；
5. Web feature 不再任意导入 server、DB、其它领域内部模块；
6. 默认 CI 对关键响应式、焦点、无障碍和资源打开路径有稳定证据；
7. 本线不重新设计视觉语言，不以大规模 CSS 重写或组件库迁移冒充架构优化。

## 二、已经确认的代码事实

| 事实                                                          | 代码位置                                                         | 本计划处理                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------- |
| `GeneralChatWorkspace` 聚合大量 state/ref/effect 和多个工作面 | `apps/web/features/workspace/general/general-chat-workspace.tsx` | 建立状态机并拆分职责        |
| 多个 handler 通过手工 `setX(null)` 保证互斥                   | 同上及相邻 hooks                                                 | 用判别联合收口              |
| Artifact 列表/Asset 刷新存在失败转空或吞错路径                | Workspace 与 Studio 相关文件                                     | 诚实失败                    |
| Source Renderer 已进入 Registry                               | `apps/web/features/canvas/**`                                    | 保留                        |
| Artifact Registry 仍使用 `ArtifactCompatibilityRenderer`      | `canvas-resource-renderers.ts`                                   | 迁移真实 Renderer           |
| Web ESLint 只有 Next 默认规则                                 | `apps/web/eslint.config.mjs`                                     | 增加边界规则                |
| 默认 E2E 排除 `@ui` 且只有 Desktop Chromium                   | `playwright.config.ts`                                           | 建立稳定 UI/移动端验证 lane |

## 三、绝对文件边界

### 允许修改或新增

- `apps/web/features/workspace/**`
- `apps/web/features/canvas/**`
- `apps/web/features/assets/**`
- `apps/web/features/studio/**`
- `apps/web/components/**` 中被上述 feature 直接拥有的组件
- `apps/web/eslint.config.mjs`
- `apps/web/vitest.config.ts`
- `apps/web/tests/**`、`tests/e2e/**`
- `playwright.config.ts`
- 与本线对应的前端 canonical 文档
- 本计划文件

### 默认禁止

- 不改 Turn Application、Agent Loop、Tool Kernel、DB schema 和 Gateway authority；
- 不实现新的 Artifact 类型、语音能力、Memory 或 Product Knowledge；
- 不替换 Next.js、React、GSAP 或现有设计系统；
- 不做全站视觉重设计；
- 不把 Server Component 数据访问迁入 Client Component；
- 不通过关闭错误提示、扩大 timeout 或增加 retry 掩盖状态错误；
- 不修改其它 active 计划文件。

若 Artifact 真实 Renderer 迁移需要改协议或后端详情接口，只能先产出接口缺口清单，由 R 或
独立后端任务处理；不得在本线私自复制 API。

## 四、共同提示词

```text
你只执行“W Web 工作面状态、Canvas 渲染与前端边界收敛”当前指定的一个原子任务。

先阅读 AGENTS.md、CLAUDE.md、本计划、统一 Canvas 架构文档、F 画布界面完成记录，
再阅读当前任务涉及的组件、hooks、API client 和测试。每条 shell 命令必须以 rtk 开头。

硬边界：
- 不修改 Agent Runtime、Gateway、DB schema、语音、Memory 或其它 active 计划；
- 不用“拆成更多文件”代替职责收敛；每个新模块必须有单一可命名职责；
- 不允许多个 boolean 重新组合出新的隐式状态机；
- 服务端失败必须保留稳定错误语义，禁止 catch 后返回空列表或假成功；
- Artifact 迁入 Registry 后必须删除旧并行渲染入口，不能长期双轨；
- 不做视觉重设计，不替换组件库；
- 不替 Codex 宣布 PASS，不提交、推送或合并。

实施规则：
1. 先用 characterization tests 固定现有关键行为；
2. 建立显式状态模型；
3. 迁移一个入口并删除一个旧入口；
4. 补键盘、移动端和错误态验证；
5. 检查 bundle、hydration 和 Client Component 边界没有恶化。

完成回报必须包含：
- 任务编号、基线 SHA、修改文件及职责；
- 旧状态/旧入口删除清单；
- 状态转换表与测试映射；
- 实际命令、退出码、截图或 trace；
- 无障碍、响应式、错误语义和回退检查；
- rtk git diff --check/name-status/status。
```

## 五、执行顺序与并行关系

```text
W00 → W01 → W02
          ├→ W03 ─┐
          ├→ W04 ─┼→ W06 → W07
          └→ W05 ─┘
```

- `W03` 诚实失败、`W04` Renderer、`W05` 静态边界可在文件不重叠时并行；
- `W06` 必须基于稳定状态模型和真实 Renderer；
- R 若同时修改 Web server，不得与 W 修改同一文件。

## 六、原子任务

### W00：Workspace 状态与资源打开基线

- 依赖：无
- 文件边界：本计划、只读源码
- 可并行：否

盘点并记录：

1. Workspace 当前全部 state、ref、effect、sessionStorage key；
2. Studio、Source、Artifact、HTML Preview、Canvas、Sidebar 的允许组合和互斥关系；
3. 所有资源打开入口、关闭入口、恢复入口和失败入口；
4. 重复 JSX、重复 Composer、重复 Artifact Canvas 和重复数据加载；
5. 当前 UI 测试覆盖与未覆盖状态。

完成标准：

- 输出状态转换表；
- 标出不可达状态、冲突状态和需要手工清理的状态；
- 每个事实有路径和行号；
- 不修改产品代码。

### W01：显式 `WorkspaceSurface` 状态模型

- 依赖：W00
- 文件边界：Workspace state/reducer/hook 及 unit tests
- 可并行：否

建立判别联合，例如：

```ts
type WorkspaceSurface =
  | { type: 'none' }
  | { type: 'studio' }
  | { type: 'source'; resourceId: string }
  | { type: 'artifact'; artifactId: string }
  | { type: 'html'; sourceId: string }
  | { type: 'loading'; target: WorkspaceTarget }
  | { type: 'failed'; target: WorkspaceTarget; code: string };
```

要求：

- 互斥关系由 reducer/transition function 保证；
- 不在组件中散落 `setSource(null)`、`closeArtifact()`、`setPreview(null)` 组合；
- 深链、恢复、关闭、Notebook 切换和资源删除有明确 transition；
- 当前视觉和用户流程不变。

完成标准：

- 每个 transition 有纯函数测试；
- 非法 transition 被拒绝或归一化；
- 删除大部分手工互斥清理；
- 不引入第三方状态机库，除非 ADR 证明必要。

### W02：拆分控制器、布局与资源槽位

- 依赖：W01
- 文件边界：`general-chat-workspace.tsx` 及新建相邻模块
- 可并行：否

目标职责：

- `useGeneralWorkspaceController`：请求、恢复和 transition；
- `GeneralWorkspaceLayout`：页面布局；
- `WorkspaceSurfaceSlot`：根据判别联合渲染唯一工作面；
- `ConversationPane`：消息与 Composer；
- Studio/Source/Artifact 各自拥有局部 controller。

完成标准：

- 主 Workspace 文件只负责组合；
- 数据请求不进入纯布局组件；
- Composer 不再复制两套行为分支；
- 每个模块手写代码低于 400 行，主组合文件显著缩减；
- React effect 数量和跨 effect 隐式依赖有下降证据。

### W03：前端诚实失败与恢复语义

- 依赖：W02
- 文件边界：Workspace、Studio、Assets、API client 及测试
- 可并行：是

目标：

- 加载失败不转换为空列表；
- `empty`、`unavailable`、`forbidden`、`not_found`、`failed`、`offline` 明确区分；
- Retry 只对可重试错误开放；
- Notebook 切换或资源删除后旧请求结果不能覆盖新状态；
- UI 不展示原始路径、堆栈、Provider body 或 Secret。

完成标准：

- 每种稳定错误有组件/行为测试；
- 无静默 `catch {}`；
- 过期请求和取消竞争有测试；
- 错误态可通过键盘完成重试或返回。

### W04：Artifact 真实 Renderer 迁入 Registry

- 依赖：W02
- 文件边界：Canvas Registry、Artifact Canvas、Artifact Renderer、相关测试
- 可并行：是

执行顺序：

1. 固定 mind map、slides、flashcards、note、audio overview、generated image、
   DOM exploration 的现有渲染契约；
2. 为每类 Artifact 注册真实受信 Renderer；
3. Registry 只接收受控详情数据，不自行读取任意 URL 或执行模型代码；
4. 迁移资源打开入口；
5. 删除 `ArtifactCompatibilityRenderer` 和旧并行分发链。

完成标准：

- Registry 打开 Artifact 即得到真实内容，不显示兼容占位；
- Source 与 Artifact 使用同一选择/错误协议；
- 评分、编辑、版本、Runtime 隔离和可访问等价物不回归；
- 旧 `ArtifactCanvas` 若保留，只能成为 Renderer 内部实现，不再是第二套路由权威。

接口缺口（W04-3，方案 A 浏览器端补齐）：

`ArtifactDetail.canvasResource` 只返回 `allowedActions`，缺少 Renderer 选择所需的
协议字段，当前由 `apps/web/features/canvas/artifact-canvas-resource.ts` 在浏览器端
按 artifact.kind 补齐：

| 缺口字段 | 当前补齐值 | 说明 |
| -------- | ---------- | ---- |
| rendererId | kind→rendererId 前端映射 | 后端 detail 应返回真实 rendererId |
| rendererVersion | 固定 1 | 后端应返回真实版本 |
| notebookId | `'unknown-notebook'` 占位 | 归属投影，前端无法得知 |
| representation.mimeType | 按 kind 固定 | 后端应返回真实 MIME |
| provenance | `agent_generated` 占位 | 后端应返回真实溯源 |
| runtime | `{ kind: 'none' }` | 后端应返回真实 Runtime 需求 |

后端在 detail 里补全上述字段后，`artifact-canvas-resource.ts` 的映射与构造可整体
删除。该接口变更属于 R 线或独立后端任务，不在 W 线私自复制 API（见本计划硬边界）。

### W05：Web 模块静态边界

- 依赖：W02
- 文件边界：ESLint、tsconfig path、必要的 feature imports
- 可并行：是

建立门禁：

- `features/**` 不直接导入 `server/**`、`@educanvas/db`、schema 或 Node-only 模块；
- feature 之间只能通过公开入口导入；
- Canvas protocol 类型可共享，具体 Renderer 不反向依赖 Workspace；
- 测试专用入口不得进入生产 bundle；
- Client Component 不导入 server-only 包。

完成标准：

- 现有违规导入清零或有明确限期 allowlist；
- 新违规在 lint 阶段失败；
- Next build 与 bundle 无 server module 泄漏。

### W06：响应式、无障碍与性能证据

- 依赖：W03、W04、W05
- 文件边界：Playwright 配置、E2E、关键组件、性能预算配置
- 可并行：否

最低矩阵：

- Desktop Chromium；
- Mobile Chrome viewport；
- WebKit 或 Firefox 至少一个第二引擎；
- 键盘-only 打开/切换/关闭资源；
- Reduced Motion；
- 失败、空、加载、长内容和窄屏状态。

性能门禁：

- 关键 route bundle 或首次 JS 预算；
- Canvas 打开与 Workspace 切换无明显重复请求；
- 大型 Renderer 按需加载；
- 无新增 hydration warning；
- 记录关键交互耗时基线，不以单次本机截图冒充性能结论。

完成标准：

- 默认 CI 保留稳定核心矩阵；
- 高波动视觉 diff 可独立 lane，但不能完全人工化；
- 所有 retry 次数被报告；
- UI lane 不依赖真实外部模型。

### W07：删除审计与收口

- 依赖：W06
- 文件边界：本计划、canonical 前端/Canvas 文档
- 可并行：否

完成标准：

- `GeneralChatWorkspace` 不再是 God Component；
- 资源打开只有一个状态权威；
- Artifact compatibility renderer 已删除；
- 所有静默失败已处理；
- Web 边界门禁和最小多端矩阵通过；
- 文档准确描述“统一 Canvas”真实完成范围。

## 七、验证台账

| 任务                  | 状态      | 证据                                                                                                                                                    |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W00 状态基线          | `PASS`    | [状态转换表、入口矩阵](../02-architecture/04-统一画布工作面-W00基线.md)（基线 `ccf5309`，行号已抽查验证；经 Codex 审核通过，PR #287）                     |
| W01 Surface 模型      | `PASS`    | `workspace-surface.ts` 判别联合 + reducer；12 个纯函数测试全绿；characterization 先固定 5 处互斥链行为并消除其不一致（经 Codex 审核通过，PR #287）       |
| W02 职责拆分          | `PASS`    | 组件 599→144 行，拆出 controller（343）/layout（124）/ConversationPane（155，Composer 双分支合并）/WorkspaceSurfaceSlot（117）；组件 useEffect 4→0、useState 11→0（互斥收敛 surface reducer）；lint/typecheck/919 测试/build 全绿；characterization 契约 8 测试保持绿（经 Codex 审核通过，PR #290） |
| W03 诚实失败          | `PASS`    | 六种错误语义统一（`canvas/resource-error.ts` + `CanvasShellStatus` 7 态，Retry 只对 failed/unavailable/offline 开放）；asset-client/canvas-resource-client 错误带 kind；useNotebookSources 结构化错误 + `LatestRequestGuard` 竞态保护；失败转空/吞错 3 处修复；error matrix：resource-error 15 + asset 12 + canvas-client 14 + CanvasShellStatus 渲染 7 + 竞态 3 测试；lint/typecheck/**951 测试**/build 全绿，无静默 `catch {}`（经 Codex 审核通过，PR #294） |
| W04 Artifact Registry | `IN PROGRESS` | W04-1 契约固定（12 测试）；W04-2 注册真实内容 Renderer（5 类适配器 + 测试）；W04-3 组合层桥接（`artifact-canvas-resource.ts` 构造渲染用资源 + `artifact-canvas-content.tsx` 内容区分发：5 类内容驱动产物经 Registry 渲染真实内容，note/dom/skeleton/empty 壳内保留；lint/typecheck/**999 测试**/build 全绿，接口缺口清单见本计划 W04 节 + Issue #306）；W04-4 删兼容占位/旧入口（删除 note/dom 交互式产物的 Registry 占位 `InteractiveArtifactPlaceholder`、映射收敛到 5 类内容驱动、交互式 kind 构造抛错 + Registry 选择 unavailable 语义；lint/typecheck/**1000 测试**/build 全绿）；剩余 W04-5 E2E |
| W05 静态边界          | `PASS`    | 门禁 A：ESLint `no-restricted-imports` 限定 `features/**` 禁 server/db/schema/server-only + 6 negative fixtures；门禁 C：共享组件移 `components/`（9 处 import）清除 Renderer 反向依赖；门禁 B：feature 公开入口以 allowlist 收口（**Issue #296** 负责人拍板，限期 W 线收口前/下季度）；ADR-0023 + `03-前端工程.md` 回写；lint/typecheck/957 测试/build 全绿（经 Codex 审核通过，PR #298） |
| W06 多端与性能        | `PENDING` | Playwright、bundle/perf evidence                                                                                                                        |
| W07 收口              | `PENDING` | full Web CI、删除清单                                                                                                                                   |

## 八、阶段级验证

```text
rtk pnpm --filter @educanvas/web lint
rtk pnpm --filter @educanvas/web typecheck
rtk pnpm --filter @educanvas/web test
rtk pnpm build
rtk pnpm test:e2e
rtk git diff --check
rtk git diff --name-status origin/main...HEAD
rtk git status --short
```

## 九、风险与回退

- 先建立 characterization tests，再切换状态模型；
- 每次只迁移一种资源表面，保持可回滚；
- Artifact Renderer 迁移保留同一详情 API，不同时重写协议和 UI；
- 若拆分后 props drilling、重复请求或模块数量显著上升，本任务判定 `REVISE`；
- 若视觉无变化但错误语义丢失，不能以截图相同判定通过。

## 十、收尾检查表

- [ ] Workspace 使用单一显式 Surface 状态；
- [ ] 主组合组件职责和行数显著下降；
- [ ] Artifact 使用真实 Registry Renderer；
- [ ] 前端不再把失败伪装为空；
- [ ] Web 模块边界由 lint 强制；
- [ ] 多端、键盘和关键性能有自动化证据；
- [ ] 稳定事实已回写 canonical 文档；
- [ ] 计划已归档并更新 active 索引。
