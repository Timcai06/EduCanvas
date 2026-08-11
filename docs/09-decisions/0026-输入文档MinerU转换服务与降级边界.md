# ADR-0026：输入文档 MinerU 转换服务与降级边界

- 状态：`proposed`
- 日期：2026-08-11
- 负责人：hzlgou
- 相关文档：[输入文档统一 md 需求与技术路线](../research/2026-08/02-输入文档统一md需求与技术路线.md)、[MinerU 部署手册](../research/2026-08/03-MinerU部署手册.md)

## 背景

教学资料以 docx/pptx/xlsx/pdf 为主，当前 `extractAssetText` 只输出**无结构纯文本**
（unpdf / mammoth），公式、表格、标题层级全部丢失，无法支撑 Canvas 中"输入统一为
md 渲染"的目标。需求调研（见技术路线文档，引擎对比均源码级核实）选定 **MinerU**
作为统一转换引擎，本 ADR 记录其接入形态与边界；它扩展自 ADR-0010（异步文本抽取），
不改变其账本与幂等语义。

## 候选方案

| 方案 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| A. 独立 mineru-api 服务 + REST（推荐） | Python 独立服务（GPU），EduCanvas worker 以 REST 异步调用 | 单一输出契约；公式全覆盖（docx OMML→LaTeX、PDF MFR）；中文/扫描 PDF 针对性最强；docx/pptx/xlsx 秒级零模型；用户已日常使用桌面端、质量有信任背书；转换不阻塞 worker 事件循环 | 需部署 Python 服务 + 下载模型（~4.7GB）；无内置认证需内网部署；结果保留 24h 需及时取 |
| B. anydoc + MinerU 双轨 | 常规格式进程内 anydoc，复杂/公式/扫描走 MinerU | 轻量格式快、免部署 | 双引擎双契约；边界判定维护成本；anydoc 无公式无 OCR，对 K12 中文教学文档覆盖弱 |
| C. 进程内 spawn mineru CLI | `child_process.spawn('mineru', ...)` | 无网络拓扑 | 模型加载耗时长、阻塞 worker 事件循环、多实例不兼容；Serverless 场景不可行 |

## 决定

1. **独立服务 + REST**：部署 `mineru-api`（Python 独立服务）作为转换引擎，EduCanvas
   worker 异步调用：`POST /tasks`（multipart 上传）→ 轮询 `GET /tasks/{id}` →
   `GET /tasks/{id}/result`。不做进程内 spawn。
2. **后端选择与格式路由**：已源码核实（`cli/common.py:_process_office_doc`）——
   docx/pptx/xlsx 在任意 backend 下都**先走 office 解析器**（零模型、秒级、不吃
   显存），backend 只影响 PDF/图片路径。因此 worker 统一提交 `hybrid-engine`：
   office 文件自动走 office，PDF 走 GPU 最高精度（公式/扫描件最优），无需按类型
   切换提交参数。**格式路由**（不是所有文本都过 MinerU）：PDF/DOCX/PPTX/XLSX 进
   MinerU 转换链；**TXT/MD 不调 MinerU**——严格 UTF-8 解码 + 规范化后直接成为
   md representation（即现有 TextDecoder fatal 路径）；独立图片资产不进 md 链，
   保留原图供视觉上下文（可附加 OCR/说明文本，但不能只剩 OCR）；音视频后续保留
   原媒体预览 + 派生带时间戳 transcript，不强行伪装成文档。
3. **三层表示边界**：上传原件、派生表示、输出产物是**三层，不互相替代**。
   - **Source（原件，不可变）**：上传的 PDF/DOCX/PPTX/XLSX/TXT/MD 保留原始
     MIME、版本身份与下载/预览路径；PDF 在 Canvas 中继续按原格式预览，不因
     生成了 md 就替换原件预览。
   - **派生 representation**：MinerU 生成的 md + 派生图片 + content_list_v2
     是同一 `assetId + versionId` 下的派生表示，供 Agent 上下文、检索与
     "Markdown 阅读模式"使用。
   - **Agent 输出 Artifact**：模型输出是另一类 Artifact（markdown artifact /
     interactive artifact），不覆盖输入 Source。
   数据流：`original source → derived markdown/assets → Agent context →
   markdown artifact / interactive artifact`。
4. **输出落库（md + 派生图片本轮保留）**：转换结果以 md 为主表示，同时**保留
   MinerU 派生图片**（负责人评审意见：只留断裂图片引用的 md 会让教材插图、图表、
   公式截图与页面关系再次丢失，与"多模态输入"目标冲突）：
   - md 写对象存储 `derived/text/<sha>/index.md`（contentType `text/markdown`，
     沿用 `ASSET_TEXT_MAX_CHARACTERS` 截断保证有界），`asset_versions.extracted_text`
     同事务双写**重写后**的 md（兼容现有读路径）；
   - 派生图片写 `derived/text/<sha>/images/`（与文档版本绑定的**不可变派生目录**），
     附 `manifest.json`：每图 hash、MIME、大小；图片**数量与总字节有界**（超限
     任务失败，见健壮性边界）；
   - **md 相对链接重写**：`![](images/xxx.jpg)` → 已鉴权的 Source resource URL
     （服务端代理/签名路由），**浏览器不直接持有对象存储 key**；
   - `content_list_v2` 存对象存储（同身份派生 json，不新增 DB 字段，"开发中"
     格式风险不扩散），其中 image 结构化块（文件名/位置）与派生图片对应；
   - 解包校验：文件名/path traversal、压缩包总大小、单图大小、总解包大小均设
     上限，违规即任务失败（稳定码），不静默丢弃。
   - **Agent materialization**：Agent 可同时使用结构化 md 与必要的原生图片
     （native image parts），但受图片数量/总字节预算与 Notebook 权限复验
     约束（与既有 Notebook 权限模型一致）。
5. **降级与失败语义（对系统和用户可见）**：所有 mineru 确定性失败（服务不可达/
   轮询超时/转换失败/结果损坏/配置非法）都降级到现有纯文本抽取（unpdf/mammoth，
   成本低）；纯文本成功则 job `succeeded`，**但 representation 质量状态写
   `degraded_plain_text`**（结构化转换成功为 `structured`），落
   `asset_versions` 新增枚举列（本 ADR 唯一的 DB schema 变更），Canvas/来源
   列表显示"结构化解析 / 已降级为纯文本"，Agent context snapshot 记录实际使用
   的 representation、producer 与 producerVersion；缺公式/缺表格的 fallback
   **不等于** MinerU md。纯文本也失败才 job `failed` + 纯文本稳定码。语义层次：
   **DB 的 failure_code = 最终结果的失败原因；mineru 环节码只进日志**（见
   "可追溯性"）。重跑 MinerU 可生成新的派生版本，但不得修改已冻结的 Turn 上下文。
   不预检 health——连接失败自然走降级，减少每次任务的额外 RTT。
6. **输出选择与呈现安全**：呈现层可选 **自动 / Markdown 文档 / 交互 Canvas**。
   - Markdown 输出落为**可编辑、可导出的 Markdown Artifact**；
   - 交互内容优先输出受 Canvas Protocol 校验的结构化 Artifact，由可信
     React/HTML renderer 呈现（继承 ADR-0004/0009 分层信任模型，主应用 origin
     不执行模型生成的任意 HTML/JS）；
   - 仅确需自由 HTML/CSS/JS 时进入 sandboxed iframe：无 same-origin、无主应用
     Cookie/Storage、无任意网络、锁定 CSP，通过闭集 postMessage 协议通信；
   - 不新建第二套 Agent loop，输出仍由现有 TurnApplicationService 与
     Canvas/Tool 路径产生。
7. **配置**：`MINERU_API_BASE_URL` 环境变量（本地 `http://127.0.0.1:8001`，
   服务器 `http://127.0.0.1:8000`；本地因镜像网络模式与 Windows 桌面端共享
   localhost 故用 8001）。
8. **部署形态**：mineru-api 绑定回环地址，仅内网访问；模型离线预下载
   （`MINERU_MODEL_SOURCE=local`），并发起步 1 防 OOM。
9. **支持面扩展**：`supportsTextExtraction` 与上传 mime 白名单新增 pptx/xlsx
   （现仅 pdf/docx/txt/md），使 Office 全家族可进转换队列。

## 原因

- "输入统一 md"的核心是**契约统一**，单引擎最干净；MinerU 五大后端共用同一套
  输出契约（`.md` + `content_list_v2.json`），worker 侧只需适配一套协议。
- 公式是 K12 数学/科学文档的硬需求：MinerU 是当前唯一实测 docx 公式
  （OMML→LaTeX）与 PDF 公式（MFR）双路径覆盖的引擎。
- 用户已日常使用 MinerU 桌面端，转换质量有真实信任背书；服务器与本地均已有
  GPU（2080 Ti 11GB / 5070 Ti 12GB），hybrid-engine 精度 95+。
- 独立进程隔离：转换不阻塞 worker 事件循环，与现有对象存储/落库架构解耦，
  可按需横向扩展（`mineru-router` 多 worker）。

## 后果

- **新增部署依赖**：需要 Python ≥3.10、<3.14 环境 + 模型 ~4.7GB + 磁盘 20GB+；
  服务器已按部署手册（03-MinerU部署手册.md）就绪，本地 WSL venv 环境已实测通过。
- **安全**：mineru-api 无内置认证，必须内网/回环部署，公网暴露需自建网关 + TLS；
  上传文件大小上限由 Node 侧控制；md 图片链接重写为鉴权 URL，对象存储 key
  不落浏览器。
- **派生图片存储成本**：图片随 md 全量保留，新增对象存储量与下载带宽；
  解包/命名/数量校验是硬性要求（见健壮性边界），防 zip 炸弹与 path traversal。
- **schema 变更**：`asset_versions` 新增 `representation_status` 枚举列
  （`structured` / `degraded_plain_text`）——本 ADR 唯一的 DB 变更，降级事实
  的可查询落点。
- **任务时效**：结果 zip 保留 24h，worker 侧需及时拉取；失败仅有 `failed` +
  error 字符串，Node 侧需解析分类映射稳定码。
- **许可合规**：MinerU Apache-2.0 + 附加条款（对第三方在线服务须署名、超规模门槛
  需商业授权）——当前内网自有部署在条款范围内，后续对外开放需复核。
- **schema 演进**：`content_list_v2` 官方标记"开发中，格式可能调整"，落库需
  版本化，不假定字段稳定。
- **遗留**：原纯文本抽取（unpdf/mammoth）保留为降级路径，不删除。

## 健壮性边界（实现硬性要求）

复用现有机制：确定性失败写终态 vs 瞬时失败退避重试（`extract-asset-text.ts`）、
账本幂等（仓储领任务/结算）、稳定失败码只追加、model-gateway 的 AbortController 超时模式。
在此基础上，MinerU 接入必须满足：

1. **连接拒绝与超时分离**：连接拒绝（服务未部署）是确定性失败，直接降级纯文本并写
   稳定码，不重试；网络超时是瞬时失败，允许退避重试。
2. **轮询总时长上限**：转换任务最长等待 **15 分钟**，超时写
   "转换超时"稳定码，不允许无限轮询。
3. **单次请求超时**：`POST /tasks`（含大文件上传）、状态轮询、结果拉取各有独立
   超时（复用 AbortController 模式）；结果响应设大小上限，防止无界读入内存。
4. **在途并发背压**：mineru-api 并发为 1，worker 侧限制同时在途的转换请求数，
   防止队列无限堆积。
5. **结果校验**：转换返回 md 为空、JSON 损坏或缺关键字段，分别映射稳定失败码，
   绝不静默当成成功（"失败不伪装成空"）。
6. **配置语义**：`MINERU_API_BASE_URL` 未配置 = 转换能力不启用，自动走纯文本
   降级路径，与 MODEL_GATEWAY"空则禁用"一致；配置格式非法则拒绝该任务。
7. **重复提交容忍**：网络中断导致 graphile 重投时可能向 mineru-api 重复提交转换
   任务（服务侧多跑一次），靠账本幂等保证不重复落库；接受该浪费，不做幂等键。
8. **任务时效**：mineru-api 结果保留 24h，任务终态后立即拉取，不缓存。
9. **图片解包与命名校验**：派生图片仅接受白名单扩展名（jpg/png/webp/gif/svg
   视渲染器支持而定）；文件名做 path traversal 防护（拒绝 `../`、绝对路径、
   非 UTF-8 名称）；压缩包总大小、单图大小、图片数量均有上限，超限即任务失败
   （稳定码），不静默丢弃（"失败不伪装成空"）。

## 可追溯性（问题溯源设计）

1. **失败码语义层次**：DB 的 `failure_code` = 最终结果的失败原因（降级后仍失败
   时为纯文本稳定码，如 `pdf_text_unavailable`）；mineru 环节码
   （`mineru_service_unavailable` 连接拒绝 / `mineru_parse_timeout` 轮询超时 /
   `mineru_parse_failed` 转换失败 / `mineru_result_invalid` 结果损坏 /
   `mineru_config_invalid` 配置非法）在降级成功的场景只进日志。两者结合还原
   完整失败链：DB 定位最终原因，日志定位经过的环节。
2. **引擎版本溯源**：`asset_processing_jobs.producer='mineru'`、
   `producer_version=` MinerU 版本号（如 `3.4.4`），复用 D04 身份字段——
   "这份 md 是哪个引擎版本转的"永久可查，引擎升级自动体现。
3. **jobId 贯穿的结构化日志**：worker 任务日志以 jobId 为链路键，每个阶段一行：
   提交成功（记录 mineru `task_id`）→ 轮询（第 N 次、状态）→ 终态 → 失败
   （阶段 + 稳定码 + error 摘要）。原始错误与诊断细节只进日志、不进 DB，
   符合"不保存原始异常/路径/堆栈"规范；现有 worker 无日志，本接入须补齐。
4. **交叉印证**：worker 日志与 mineru-api 服务日志均含 `task_id`，出问题时
   两侧对查即可还原完整转换链路。
5. **representation 质量落点**：`asset_versions.representation_status`
   （`structured` / `degraded_plain_text`）是降级事实的**可查询落点**（DB
   而非仅日志）；status 与 producer/producerVersion 同版本记录，UI 展示与
   Agent context snapshot 均读此字段，不做二次推断。

## 验证方式与实现验收标准

**部署验证**（已通过）：服务器 2080 Ti 与本地 5070 Ti 均完成真实含公式
PDF/docx 转换，产出 md + content_list_v2 + images/。

**实现验收标准**（负责人评审要求的 8 条，实现完成后逐条验证）：

1. 上传 PDF 后，原 PDF 仍按原格式预览（三层边界：Source 不被派生替代）；
2. 同一 PDF/DOCX 产生绑定版本的结构化 md，标题/表格/公式有样本验证；
3. MinerU 图片经鉴权资源路由显示，对象存储 key 不泄露给浏览器；
4. Agent 收到 md，并在需要时收到受预算限制的原生图片；
5. MinerU 停机时回退纯文本，但 UI 与 Agent 上下文明确显示
   `degraded_plain_text`；
6. 用户选择 Markdown 输出后得到可编辑、可下载的 `.md` Artifact；
7. 交互式输出无法越过 sandbox 访问主应用身份、存储或非白名单网络；
8. 旧资产与旧 `text/plain` representation 仍可读取，迁移/兼容边界明确。

**降级验证**：停掉 mineru-api 后上传文档，确认走纯文本降级路径、`degraded_plain_text`
如实写入、UI 显示降级标记、failure_code 诚实。

## 附录：mineru-api 协议与产物细节（审查参考）

基于 mineru 3.4.4 源码核实 + 本地实测（2026-08-11），供审查对照，不构成决策。

**REST 三步协议**：

1. `POST /tasks`：multipart 表单上传。参数：`files`（可多个）、`backend`
   （`pipeline`/`vlm`/`hybrid-engine`）、`formula_enable`、`table_enable`、
   `return_content_list`、`return_md`、`response_format_zip` 等；返回任务 ID。
2. 轮询 `GET /tasks/{id}`：状态字段 queued/processing/completed/failed 及统计。
3. `GET /tasks/{id}/result`：`response_format_zip=false`（默认）时返回 JSON
   `{"results": {"<文件名>": {"md_content": ..., "content_list": ...}}}`；
   zip 模式返回打包产物。任务结果保留 **24h**（`task_retention_seconds: 86400`）。

**转换产物结构**（实测确认）：`<task_id>/<文件名>/` 目录下 `.md` +
`content_list_v2.json` + `middle.json` + `images/`（无图文档 images/ 为空）；
md 内图片为相对引用 `![](images/xxx.jpg)`；content_list_v2 按页分组的结构化块
（type 含 text/image/table/equation/list/paragraph 等，官方标记"开发中，格式
可能调整"）。本轮 worker 取结果时**全量保留 images/ 到派生目录**（见决定 4），
md 相对链接重写为鉴权 resource URL 后落库。

**实测基线**（2026-08-11）：服务器 RTX 2080 Ti 11GB 与本地 RTX 5070 Ti 12GB
均完成真实 docx→md 转换通过；并发 1 时推理显存 ~3.1/12GB、进程 RAM ~1.1GB
（模型驻显存不占 RAM）；office 文件秒级完成（office 解析器，零模型），PDF/图片
走 GPU（hybrid-engine 精度 OmniDocBench 95.39）。
