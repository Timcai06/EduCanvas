# Web 搜索与研究来源

- 任务分配名：`WS Web 搜索与研究来源`
- 状态：`active`
- 负责人：@Timcai06
- 代码审核与最终验收：Codex；电脑浏览器视觉验收由项目负责人确认
- 最后验证时间：2026-08-22
- 起始本地基线：`ebf8d4a052f2c656644c9762d3c0dbb65113869d`
- 关键决策：[ADR-0031](../../09-decisions/0031-Web搜索与网页来源获取边界.md)
- 上游计划：[RM 统一资源工作台](../completed/RM-统一资源工作台.md)

## 一、目标

在既有批量网页导入与 Deep Research 基础上，交付一套由内置网站搜索和唯一 Agent Loop
共同使用的 Web Intelligence 底座。用户可以搜索、选择并导入公开网页；Agent 可以多轮发现、
读取和替换不可用来源，最终生成只引用实际持久化 Source 的报告。

本阶段不做网页导入前预览，不把外部网页转换成 Canvas 交互产物。Canvas 继续只预览 LLM
生成并通过 Tier 2 Runtime 接纳的交互式界面。

## 二、已交付基线

合并提交 `ebf8d4a052f2c656644c9762d3c0dbb65113869d` 已提供：

- 最多 10 个 URL 的批量导入、并发 3、逐项状态、稳定错误和重试；
- 原始 HTML、最终 URL、标题、Content-Type 与抓取时间的版本级网页溯源；
- Worker 静态正文抽取和小正文页面的 Chromium 渲染降级；
- `web.search` 与 `web.fetch` 接入唯一 Tool Kernel；
- Deep Research 入口、搜索/读取/综合进度和研究来源标识；
- 三次成功搜索、五个持久来源、五个有效引用的确定性输出闸门；
- 引用优先打开 Notebook 内 Source，而不是直接离开产品。

上述基线通过本地全仓 typecheck、lint、unit tests；本次按项目负责人授权未创建或等待 CI。
电脑浏览器视觉和真实搜索 Provider 仍不属于自动化通过证据。

## 三、范围

- Provider-neutral SearchService 与多 Provider 降级；
- Sources/网页导入入口中的内置网站搜索；
- 搜索候选可访问性预检、自动补位、相关性和来源多样性排序；
- Agent 多轮搜索的缺口分析、候选读取和失败恢复；
- Fake-IP/代理环境诊断与受控 egress 设计；
- 研究来源持久化、删除、引用、刷新恢复与后续追问；
- 安全错误、进度、Provider 健康和抓取失败的低基数观测；
- 电脑浏览器功能与视觉验收。

## 四、非目标

- 网页导入前标题、摘要、正文或截图预览；
- 在 Canvas 中执行、镜像或复刻外部网页 HTML/JS；
- 第二个 Agent Loop、Deep Research 专属 Runtime 或浏览器端 Agent；
- 向浏览器暴露 Provider Key、原始响应、Prompt、Tool 参数或内部错误；
- 使用搜索摘要替代实际读取来源；
- 移动端、跨浏览器、桌面客户端或其他环境验证。

## 五、执行顺序

```text
WS00
  ↓
WS01 → WS02
          ├→ WS03
          └→ WS04 → WS05
WS03 + WS05 → WS06 → WS07
WS00-WS07 → WS08 → WS09
```

## 六、原子任务

### WS00：冻结架构与事实基线

- 依赖：无
- 状态：`PASS`
- 文件边界：ADR-0031、本计划、现有实现与验证记录

交付：

- 明确网页导入不做预览，外部网页不进入 Canvas Web Runtime；
- 冻结 `web.search` 发现、`web.fetch` 读取持久化和 Source 引用权威；
- 记录已实现基础、未验证环境和下一阶段任务边界。

完成标准：ADR、代码事实和 active 计划不存在相互冲突的预览或第二 Agent Loop 要求。

### WS01：Fake-IP 诊断与受控网络出口

- 依赖：WS00
- 状态：`PASS`
- 文件边界：asset-processing URL guard、运行环境检查、运维文档与负向测试
- 最后验证时间：2026-08-17

交付：

- 将所有域名解析到 `198.18.0.0/15` 的环境识别为稳定 `fake_ip_dns_detected` 运维错误；
- 为本地代理给出可操作配置，而不是泛化为"地址不允许访问"；
- 评估并实现可验证目标地址的受控 resolver/connector，或明确部署使用真实 DNS 的 egress；
- 每次重定向继续重验目标，禁止直接放行保留地址段。

完成标准：真实私网地址仍被阻止；Fake-IP 环境能被准确诊断；公开网页在受支持配置中可抓取。

验证证据：

- `pnpm --filter @educanvas/asset-processing exec vitest run src/web-page.test.ts`：32/32 通过
- `pnpm --filter @educanvas/web exec vitest run app/api/v1/chat/assets/link/route.test.ts features/assets/asset-client.test.ts server/tools/web-page.test.ts`：24/24 通过
- `pnpm typecheck`：26 tasks 通过
- `pnpm lint`：All matched
- `pnpm test:unit`：1714/1714 通过
- `git diff --check`：无问题
- 域名全部解析到 Fake-IP → `fake_ip_dns_detected`
- IP 字面量 198.19.x.x → `link_blocked_host`
- 重定向到 IP 字面量 → `link_blocked_host`
- 重定向到域名且该域名解析为 Fake-IP → `fake_ip_dns_detected`
- Agent Tool 保留专用错误码 `fake_ip_dns_detected`
- 运维文档 `docs/07-operations/02-Fake-IP-DNS诊断.md` 已创建

### WS02：Provider-neutral SearchService

- 依赖：WS01
- 状态：`PASS`
- 文件边界：Web server search adapters、配置检查、Provider 契约和测试

交付：

- 把 Tavily Adapter 收敛到统一 SearchProvider Registry；
- 接入至少一个备用 Provider 或自建 SearXNG Adapter；
- 定义 Provider 顺序、超时、429/5xx 切换、请求预算和健康冷却；
- 对所有 Provider 响应做严格 Schema 校验、URL 规范化和安全错误投影。

完成标准：主 Provider 故障时可在预算内使用备用 Provider；普通聊天未配置搜索时诚实降级。

实现与审核证据（2026-08-20）：

- 新建文件：
  - `apps/web/server/tools/search-contract.ts` — Provider-neutral contract (SearchRequest, SearchResult, SearchProviderError, ProviderHealth)
  - `apps/web/server/tools/provider-health.ts` — ProviderHealthTracker with cooldown, failure threshold, controllable clock
  - `apps/web/server/tools/search-registry.ts` — SearchProviderRegistry with registration order, enable/disable, health-aware selection
  - `apps/web/server/tools/search-service.ts` — SearchService with bounded timeout, total budget, max attempts, abort signal, SearchServiceError short-circuit
  - `apps/web/server/tools/search-url.ts` — Provider URL 与搜索结果 URL 的统一规范化和安全过滤
  - `apps/web/server/tools/tavily-adapter.ts` — TavilyAdapter using new contract with strict Zod schema validation
  - `apps/web/server/tools/searxng-adapter.ts` — SearXNGAdapter as second provider with SEARXNG_BASE_URL env validation
- 重构文件：
  - `apps/web/server/tools/web-search-provider.ts` — 保留旧 Tavily `{ results }` 契约的兼容适配层
  - `apps/web/server/tools/web-search.ts` — resolveWebSearchTool now uses SearchService + SearchProviderRegistry
  - `apps/web/server/tools/web-search.test.ts` — 26 tests covering primary success, timeout/network/429/500 failover, budget cancellation, cooldown, provider validation, compatibility, query dedup and candidate caps
  - `.env.example`、`tooling/env-check.mjs`、`tooling/search-env.mjs`、`tooling/env-check.test.mjs` — 搜索 Provider 配置闭合、URL 与秘密形状校验
- 验证结果：
  - `pnpm typecheck` — clean
  - `pnpm lint` — clean (0 errors, 0 warnings)
  - `pnpm --filter @educanvas/web test` — 1737/1737 通过（236 files）
  - `pnpm --filter @educanvas/web exec vitest run server/tools/web-search.test.ts` — 26/26 通过
  - `node --test tooling/env-check.test.mjs` — 26/26 通过
  - `git diff --check` — clean
  - Prettier formatting — clean
  - `pnpm test:unit` 未计入 PASS：当前机器的 `local-core-cleanup` / `local-orchestrator` 进程夹具失败并超过 12 分钟；WS02 所属 Web 全包与配置测试已独立通过，最终全仓结果交由 CI 判定
- Codex 审核修正：服务级超时会中止底层 Provider I/O；冷却与未配置错误分离；原生网络错误可降级；非法 Provider payload 使用稳定错误；Provider URL 拒绝凭据、query、fragment；旧 Tavily `{ results }` 契约保留。
- 审核结论：无 CRITICAL/HIGH 遗留，`PASS`；真实 Provider 与电脑浏览器验证仍归 WS09，不作为 WS02 自动化替代证据。

### WS03：内置网站搜索入口

- 依赖：WS02
- 状态：`PASS`
- 文件边界：Sources/网页导入 UI、Web BFF search route、客户端契约

交付：

- 网页导入面板提供“输入网址 / 搜索网页”两个入口；
- 搜索结果展示标题、域名、摘要、可访问状态和已导入状态；
- 用户可多选结果并直接批量导入，不增加预览确认步骤；
- 搜索、选择、导入和失败重试支持键盘与读屏。

完成标准：用户不依赖 Agent 即可搜索并导入多个网页；浏览器响应不含 Provider 私有字段。

实现证据（2026-08-21）：

- 新增同源、会话鉴权的 `POST /api/v1/chat/assets/link/search` BFF；只投影标题、URL、域名、摘要、可访问状态和导入状态，Provider 名称、健康、尝试记录与原始响应不进入浏览器；
- 网页来源面板提供“输入网址 / 搜索网页”双入口；搜索结果使用原生复选框多选并直接有界并发导入，不增加预览确认步骤；
- 搜索输入关联可见标签并兼容中文输入法组合态；标签页、选择、全选、搜索、批量导入与失败重试均可通过键盘和读屏语义操作；高频加载动画遵循 `motion-reduce`；
- 浏览器客户端使用严格 Zod 契约拒绝额外 Provider 私有字段或畸形结果；取消浏览器请求会继续向下中止 Provider I/O；同步运行锁阻止搜索和批量导入重复提交；
- `pnpm --filter @educanvas/web test` — 1745/1745 通过（239 files）；
- `pnpm lint`、`pnpm typecheck`、`pnpm file:check`、`git diff --check` — clean；
- 集成结论：PR #395 的静态、单元、Secret Scan、Chromium E2E 与最终 checks 全绿，合并提交 `ad95bcad`；审核结论 `PASS`。真实 Provider 与电脑浏览器验证继续归 WS09。

### WS04：候选预检、排序与自动补位

- 依赖：WS02
- 状态：`PASS`
- 文件边界：SearchService candidate pipeline、web fetch policy、测试 fixture

交付：

- 每轮超额获取候选，按规范 URL 去重；
- 有界并发检查地址、HTTP、格式、正文可提取性和渲染需求；
- 对 403、登录墙、空正文、限流、超时、格式和渲染错误分类；
- 失败域名进入本轮冷却，候选不足时继续搜索；
- 相关性排序同时约束域名、机构和内容类型多样性。

完成标准：前五条中多数不可用时仍能从后续候选收敛出可读来源；不可用页面不占引用编号。

实现证据（2026-08-21）：

- 新增 Provider-neutral 候选管线：按目标数三倍超额获取、规范 URL 去重、最多 15 个候选、最多 3 个域并发预检；同域严格串行，首个失败后本轮同域候选冷却；
- 预检复用正式网页导入的 SSRF、DNS、逐跳重定向、默认端口、响应大小与正文抽取边界，不持久化网页，也不分配引用编号；外部取消继续中止底层 I/O；
- 稳定分类 blocked address、HTTP blocked/error、login wall、empty content、rate limit、timeout、unsupported format、render required/unavailable、too large、network error 与 domain cooled；
- SearchService 在候选不足时继续下一个健康 Provider；Tavily 按官方 `max_results` 0–20 约束，在本管线预算内最多获取 15 条，单 Provider 也可从前五之后补位；
- 可读候选按相关性贪心排序，同时限制每域最多 2 条，并对机构与 article/documentation/institution/other 内容类型重复施加多样性惩罚；重定向后的最终 URL 再次安全规范化与去重；
- 浏览器 BFF 与 Agent `webSearch` 均使用预检管线；浏览器只看到可读取候选，Provider、失败明细和尝试记录留在服务端；不可用候选不会进入后续网页读取与引用账本；
- `pnpm --filter @educanvas/web test` — 1760/1760 通过（240 files）；候选/搜索/BFF 定向测试 45/45 通过；
- `pnpm lint`、`pnpm typecheck`、Prettier、`git diff --check` — clean；
- Codex 审核结论：CRITICAL 0、HIGH 0；PR #396 的静态、单元、Secret Scan、Chromium E2E 与最终 checks 全绿，合并提交 `bad2d1c5`，状态更新为 `PASS`。真实 Provider 与电脑浏览器验证仍归 WS09。

### WS05：Agent 自适应多轮研究

- 依赖：WS04
- 状态：`PASS`
- 文件边界：General profile、Tool budgets、Deep Research guard 与测试

交付：

- 保持唯一 Agent Loop，按广搜、缺口分析、关键问题深搜推进至少三轮；
- 将候选失败反馈给下一轮查询，而不是重复调用同一域名；
- 允许在总预算内追加替代查询，同时对调用数、候选数、读取数和上下文字符数设上限；
- 最终报告继续由确定性 `3 searches / 5 sources / 5 citations` 闸门收口。

完成标准：研究任务在部分候选不可用时能够自动补位；未达标时返回稳定失败而不是伪造引用。

实现证据（2026-08-22）：

- Deep Research 仍复用唯一 `AgentLoopEngine`，仅将该 Profile 的工具轮次提升到 6，为广搜、缺口补搜、关键问题深搜、替代查询和替代来源读取保留顺序空间；普通 General Turn 仍为 3 轮；
- `webSearch` 在研究模式返回受限 `research` 反馈：`broad / gap / deep / replacement` 阶段、最多 8 个失败域与稳定失败码、剩余搜索次数和下一步动作；Prompt 要求后续查询消费该反馈，不引用搜索摘要；
- 候选管线把预检失败域保留在当前 Operation 的冷却集合中，后续搜索遇到同域候选直接标记 `candidate_domain_cooled`，不再发起网络预检；
- 研究搜索最多 5 次（前三轮 + 最多两轮替代），全 Operation 最多保留 15 个候选；来源读取仍由 `WebOperationSources` 限制为 8 个，Turn 总工具调用 16 次、单工具结果 8,000 tokens、上下文 128,000 字符；
- 确定性输出闸门保持不变：少于 3 次成功搜索、5 个实际持久来源或 5 个有效引用时，返回 `RESEARCH_REQUIREMENTS_UNMET`，不会放行或伪造报告；
- `pnpm --filter @educanvas/web test` — 1762/1762 通过（240 files）；搜索/候选/Profile 定向测试 67/67 通过；`@educanvas/agent-runtime` 118/118 通过；相关包 typecheck clean；
- Codex 审核结论：CRITICAL 0、HIGH 0；PR #397 的静态、单元、Agent Eval、Secret Scan、Chromium E2E 与最终 checks 全绿，合并提交 `e87f62e1`，状态更新为 `PASS`。真实 Provider 与电脑浏览器验证仍归 WS09。

### WS06：研究任务恢复与进度事实

- 依赖：WS03、WS05
- 状态：`PASS`
- 文件边界：Operation/Message 事实、研究 checkpoint、Web 安全投影

交付：

- 冻结 planning/searching/reading/synthesizing/terminal 阶段和单调进度；
- 页面刷新后恢复当前研究状态，不重复已完成 Tool 副作用；
- 保存已完成查询、候选 URL、已持久 Source 与引用 ordinal 的恢复点；
- 取消、超时和重试继续使用现有 Operation 权威，不新建研究账本替代它。

完成标准：刷新或短暂断线后继续同一 Operation；来源和引用不重复。

实现证据（2026-08-22）：

- Gateway `gateway_operation_events` 继续作为浏览器恢复的唯一事件账本；新增只读增量入口按 Actor 鉴权并使用 `afterSequence`，只投影既有安全 Turn 事件，不重新进入 Agent Loop 或 Tool Kernel；
- Web SSE 断开不再等同于用户取消，后台继续完成同一 Operation；显式停止仍走既有取消事实与进程 Abort 注册表，未新增研究终态写入路径；
- 新增 `research_checkpoints` 有界执行游标：固定协议、四个单调非终态阶段、最多 5 个规范化已完成查询与 15 个公开候选 URL；Operation、Source 与 Citation 继续由既有权威表唯一负责；
- Deep Research 启动时恢复检查点与已有 `operation_sources`，搜索工具拒绝已完成查询并跳过已有候选，来源写入继续依靠 `(operation_id, locator_url)` 与 ordinal 唯一约束去重；
- Gateway 安全投影新增单调 `sequence`；刷新从持久消息基线后的 sequence 0 重放，同页短断线只使用内存游标增量接续，既不丢失早期正文，也不重复应用 delta；
- 浏览器恢复接口只返回阶段、查询/候选/来源计数、引用 ordinal、Operation 状态及安全 Tool/Message 事件，不返回原始查询、候选 URL、Prompt、Tool summary、Provider Body 或异常；
- Deep Research 进度按 `planning/searching/reading/synthesizing/terminal` 单调推进，最多显示 5 次搜索；重复 Tool 终态与重复序号 fail closed，不重复累计来源或正文；
- `@educanvas/web` 全量单测 1774/1774 通过（242 files），`@educanvas/db` 125/125 通过（14 files）；`pnpm lint`、`pnpm typecheck`、`pnpm file:check` 与 `git diff --check` clean；
- Drizzle 迁移 `0060_funny_vengeance.sql` 由 `drizzle-kit generate` 生成；提交后历史不可变、记录完整性、`drizzle-kit check` 与无差异生成均通过。fresh/N-1 本地验证因 Docker daemon 未运行而未执行，已由 PR #399 的 `migration-integration` lane 补齐并通过；
- Codex 审核结论：CRITICAL 0、HIGH 0；PR #399 的静态、单元、DB/Migration 集成、Agent Eval、Secret Scan、Chromium E2E、Release Evidence 与最终 `checks` 全绿，合并提交 `06f277bc`，状态更新为 `PASS`。真实 Provider 与电脑浏览器验证仍归 WS09。

### WS07：来源、引用与后续追问闭环

- 依赖：WS06
- 状态：`PASS`
- 文件边界：Source read model、Studio、Citation 和 Conversation hydration

交付：

- 研究来源在 Sources 中稳定标识并可删除；
- 删除后后续 Turn 不再选入该来源，但历史引用保留可审计的版本身份；
- 引用点击打开正确的 Notebook Source，并提供显式打开原网页动作；
- 刷新后报告、来源、引用和后续追问保持一致。

完成标准：五个引用逐一对应正确 Source；刷新和删除不会造成编号漂移或悬空跳转。

实现证据（2026-08-22）：

- Web 引用同时提供“打开 Notebook Source”和独立的“打开原网页”动作；原网页使用新窗口与 `noopener noreferrer`，Notebook Source 不可用时仍保留审计定位；
- 来源删除仅在服务端 tombstone 成功后更新本地列表，并触发统一 Resource Dock reload；失败不乐观移除，并发删除去重，卸载后忽略迟到回调；
- 删除接口将 repository 的 `false` 稳定映射为 `asset_not_found/404`，避免客户端误报删除成功后刷新复现；
- 历史 Citation 继续保留冻结的 AssetVersion、ordinal、label 与原始 URL；恢复同一 Operation 时只选入仍为 ready/current 的来源，tombstoned 来源不会重新进入有效上下文；
- Web 聚焦回归 20/20 通过，Web/DB typecheck、lint、文件治理与 diff 检查通过；DB tombstone/hydration 集成测试与 PR #401 的静态、单元、DB 集成、Chromium E2E 和最终 checks 全绿；Codex 审核结论 CRITICAL 0、HIGH 0，合并提交 `51e2d005`，状态更新为 `PASS`。

### WS08：安全、观测与成本边界

- 依赖：WS01-WS07
- 状态：`IN_REVIEW`
- 文件边界：日志、指标、速率限制、Provider/抓取安全测试

交付：

- 记录低基数 Provider、搜索轮次、候选数、读取结果、失败类别、耗时和补位次数；
- 浏览器错误只包含稳定 code、retryable 和操作建议；
- 对搜索、抓取、浏览器渲染和单 Notebook 并发设置速率与成本预算；
- 覆盖凭据 URL、重定向到内网、DNS rebinding、超大正文、脚本资源预算和恶意 Provider 响应。

完成标准：日志和浏览器响应不含 Key、Prompt、原始 Provider Body、网页正文或堆栈。

实现证据（2026-08-22）：

- 网页抓取每个 DNS hop 都先审核全部解析结果，再由 Node connector 将 socket 固定到其中一个审核 IP；HTTP Host 与 HTTPS SNI 保留原始域名，并核对实际 peer，重定向逐跳复审，DNS rebinding 不再依赖原生 `fetch` 的不可见连接状态；
- 抓取继承外部取消并保留 10 秒、2 MiB、5 次重定向边界；Worker 脚本仍限制 12 个资源、单资源 512 KiB、总计 2 MiB，所有重定向、错误状态和格式拒绝路径都会主动取消响应流；
- Tavily 与 SearXNG 响应改为 256 KiB 有界流读取、严格 UTF-8/JSON 与字段 schema，最多接收 20 个结果，URL/标题/摘要长度分别限制为 1024/200/400；取消和超时保持稳定分类，不读取或回传原始 Provider Body；
- 浏览器搜索、直接导入与 Agent `web.search`/`web.fetch` 共享 actor + Notebook 的进程级边界：每分钟 20 次、最多 3 个并发、最多 10,000 个 key；全部 key 活跃时 fail closed，lease 在 `finally` 恰好释放，429 提供稳定错误和 `Retry-After`；当前部署契约是单 Web 进程，横向多实例前必须迁移到共享限流存储，不能把进程内计数宣称为集群全局事实；
- 低基数指标覆盖固定 Provider、成功/失败结果、搜索耗时、候选/可读数量、闭集失败类别、研究轮次与补位次数、链接导入结果与耗时；指标注册表拒绝未声明标签，测试证明 query、URL、域名和自定义 Provider 名不会进入快照；Web 通过复用至少 32 字节的既有 Gateway internal token 提供只读 `/api/v1/internal/metrics`，未配置时 fail closed；
- 浏览器路由只投影稳定 code、retryable 与固定操作建议；未知身份、解析、Provider、导入和异常路径不返回 Key、Prompt、Provider Body、网页正文、异常 message 或堆栈；
- 聚焦与全量验证覆盖 asset-processing 网页/真实 socket connector、Web 搜索/候选/抓取/路由/限流、Worker 与 telemetry；相关包 typecheck、lint、文件治理与 diff 检查 clean。当前结论为 `IN_REVIEW`，等待 PR CI 与最终合并证据。

### WS09：电脑浏览器验收与收口

- 依赖：WS00-WS08
- 状态：`PENDING`
- 文件边界：自动化验证、电脑浏览器证据、canonical 文档与计划归档

交付：

- 批量导入 5 个链接，逐项成功或显示明确失败原因；
- 内置搜索完成查询、多选和批量导入；
- “光合作用的研究进展”完成至少三轮搜索、五个来源和五个引用；
- 点击引用打开对应 Source，研究来源可识别、删除并在刷新后保持一致；
- 运行 typecheck、lint、unit、DB/Worker integration 和桌面 Chromium 功能检查；
- 视觉结论由项目负责人确认，不以自动化结果替代。

完成标准：全部必需证据可复现；未验证项明确保留，计划完成后归档。

## 七、验证矩阵

| 能力                 | 自动化证据                    | 电脑浏览器证据       | 状态                               |
| -------------------- | ----------------------------- | -------------------- | ---------------------------------- |
| 批量 URL 直接导入    | Web/Worker/DB tests           | 项目负责人走查       | foundation passed / visual pending |
| Search Provider 降级 | Provider contract/integration | 故障注入结果         | pending                            |
| 内置网站搜索         | route/client/component tests  | 搜索、多选、导入     | pending                            |
| 不可用来源补位       | deterministic fixtures        | 真实公开网站混合样本 | pending                            |
| Deep Research        | Tool/guard/citation tests     | 三轮、五源、五引     | foundation passed / live pending   |
| Source 与引用恢复    | DB/hydration tests            | 刷新、删除、追问     | pending                            |
| 安全边界             | SSRF/provider/redaction tests | 浏览器无内部信息     | pending                            |

## 八、风险与回退

- 搜索 Provider 质量波动：保留 Provider Registry 开关和健康冷却，单 Adapter 可独立关闭；
- 真实网页长期不可读：扩大候选池并诚实失败，不使用摘要伪造来源；
- Worker 浏览器成本上升：限制并发、脚本数量、字节和运行时间，静态成功时不启动浏览器；
- Fake-IP 与 SSRF 冲突：只支持有验证语义的出口方案，不能为兼容代理放宽私网规则；
- UI 复杂度增长：内置搜索复用统一 Source intake，不复制第三套导入状态机；
- 回退时可以关闭搜索入口和 `web.search`，保留 URL 直接导入与既有 Source 读取。

## 九、收尾检查表

- [ ] WS01-WS09 均有可复现证据；
- [ ] 稳定行为回写产品、架构、工程和运维 canonical 文档；
- [ ] Provider 与网络出口决策如有变化已修订 ADR-0031；
- [ ] 电脑浏览器视觉验收由项目负责人记录；
- [ ] 未完成项转入新的 active 计划；
- [ ] 本计划压缩后移入 `completed/` 并更新索引。
