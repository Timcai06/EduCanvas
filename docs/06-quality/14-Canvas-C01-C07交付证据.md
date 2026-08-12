# Canvas C01-C07 交付证据（2026-08-12）

本记录只证明 ADR-0027 的 C01-C07 代码纵切与确定性自动化门禁。C08 的真实 Turn、浏览器、可访问性、恶意输入和性能体验仍由项目负责人验收；X01-X04 不在本轮范围。

## 交付结论

### C01 输出意图契约

- `packages/agent-core/src/output-preference.ts` 定义 `auto`、`markdown_document`、`interactive_artifact`、`web_app`；旧 `canvas` 只在服务端输入边界归一化。
- `apps/web/server/http/turn-request.ts` 对未知值返回稳定 400；General 与 Teaching 共享同一字段。
- Composer 是受控选择器，Landing 使用 Session Storage 交接；读取时重新按闭集 schema 校验，不能注入未知偏好。
- Profile 只把偏好投影为提示，不改变工具清单、身份、数据或 Runtime capability。

### C02 Markdown 文档纵切

- `packages/canvas-protocol/src/artifacts/markdown-document.ts` 提供严格的 `document.markdown.v1` canonical content，正文上限 60,000 字。
- `apps/worker/src/tasks/markdown-document-generation.ts` 与既有 `artifact:generate` Job/Version 链生成完整版本，没有第二套 Agent Loop。
- 最新版在既有 Markdown 编辑器中可编辑，保存通过 `save_markdown_document` 追加不可变版本；历史版本保持只读，并显示有界行级差异。
- 下载路由导出 `.md`；React Markdown 未启用 raw HTML 执行插件。

### C03 Artifact Proposal 统一

- `packages/agent-core/src/artifact-proposal.ts` 定义闭集 proposal，只含 `kind/title/instruction`。
- `apps/web/server/platform/general-artifact-tool.ts` 继续由服务端注入 actor、Notebook、conversation、operation 与 trust tier。
- 创建、生成中、失败、版本新增与打开继续复用 Artifact Job、Turn event 和 CanvasResource，不新建消息账本或 Agent Loop。

### C04 `mind_map.v2` 协议

- `packages/canvas-protocol/src/artifacts/mind-map.ts` 同时接受历史 v1 树和 v2 节点/边/分组结构。
- v2 固定节点、边、分组、标签与四层深度上限；层级边要求唯一根、唯一父级、无环且全部可达。
- association、sequence、contrast 与 cause 只表达语义，不改变层级拓扑。
- `rendererVersion` 是 Renderer 实现轴，不等于 `contentVersion`；当前同一注册 Renderer 明确兼容 v1/v2，历史版本不会被静默迁移。

### C05 思维导图 Renderer

- `apps/web/features/canvas/mind-map-layout.ts` 提供确定性树布局，并兼容 v1/v2。
- `apps/web/features/canvas/mind-map-renderer.tsx` 提供曲线边、缩放、平移、适配视图、折叠、焦点、节点提问、键盘操作与 reduced-motion。
- 120 节点 fixture 固定协议与布局边界；本轮不声称已完成真实浏览器 FPS 测量，该项属于 C08。

### C06 `web_app.v1` 纵切

- `packages/canvas-protocol/src/web-runtime-artifact.ts` 固定 manifest、entry、文件 hash、capability、budget、diagnostics 与自包含依赖字段。
- v1 的 `lockedDependencies` 必须为空：仓库尚无离线依赖字节 loader，协议、生成器、DB admission 与 Runtime 对此一致 fail closed；未来支持依赖必须升级内容版本并交付 loader。
- Worker 对模型输出重算 hash，覆盖安全预算、capability 与诊断，并拒绝外部 URL、网络 API 和模块导入。
- DB admission 与 Host 再校验 path、entry、hash、预算和网络语法；Runtime 仍使用 ADR-0019 的不透明 origin、一次性 bootstrap、`sandbox="allow-scripts"`（无 `allow-same-origin`）、credentialless 与闭集 bridge。
- Canvas 提供预览、源码、构建三面板；Live preview 不创建持久 Runtime。

### C07 编辑、版本与导出

- Markdown 直接编辑、三类 Agent revision 与历史恢复都追加不可变版本；恢复不移动旧版本或改写历史。
- Markdown、Mind Map 与 Web App 可下载当前或历史版本；媒体沿用验证后的私有对象读取。
- Web App 导出剥离 `sourceConversationId`；所有导出不包含对象存储键、checksum、运行凭据、Provider 原始响应或堆栈。
- 历史版本按 CanvasResource `allowedActions` 决定恢复/下载，跨 Notebook 与不存在保持同形 404。

## 自动化证据

提交前的合并式定向验证一次通过 235 个用例：Agent Core 14、Canvas Protocol 23、Worker 33、Web Runtime 8、Web 157。六个受影响包的 TypeScript 检查全部通过，Web ESLint 与 DB Prettier 检查通过。覆盖：

- Agent Core：输出偏好与 Artifact Proposal；
- Canvas Protocol：Markdown、Mind Map v1/v2、资源投影与 Web App v1；
- Worker：Markdown、Mind Map、Web App 生成及统一 Artifact Job；
- Web Runtime：manifest 编译、路径、hash、依赖、网络与 Host 拒绝路径；
- Web：Turn parser/Profile/Tool、Artifact API、编辑/恢复/下载、三类 Renderer 与 Web App Live 降级。

DB Runtime integration 测试保留在 `packages/db/src/web-runtime-run-repository.integration.test.ts`，若本地缺少隔离的 `TEST_DATABASE_URL` 则由 CI 数据库门禁执行；不把未执行的本地集成测试写成已通过。

## 文件治理决定

C01-C07 纵切使 9 个既有编排/边界模块达到 400-577 行。它们均未越过 600 行硬拆分线，且由本命名计划明确拥有，因此本轮在 `tooling/quality/file-size-baseline.json` 冻结当前值，不继续增长。后续新增责任前必须先拆分，不能再次仅扩大 baseline。

## 未完成边界

- C08 保持 `PENDING`：由项目负责人验证真实 Turn 三种生成、桌面/窄屏、键盘、恶意脚本、资源超限、历史回放与大型导图体验。
- 不触碰 X01-X04；Live × Canvas、ADR-0026 provenance、联合 CI 与最终归档仍按原计划执行。
