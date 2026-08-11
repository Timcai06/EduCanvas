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
2. **后端选择**：已源码核实（`cli/common.py:_process_office_doc`）——docx/pptx/xlsx
   在任意 backend 下都**先走 office 解析器**（零模型、秒级、不吃显存），backend
   只影响 PDF/图片路径。因此 worker 统一提交 `hybrid-engine`：office 文件自动走
   office，PDF 走 GPU 最高精度（公式/扫描件最优），无需按类型切换提交参数。
3. **输出落库**：转换结果以 md 为主表示：md 写对象存储
   `derived/text/<sha>.md`（contentType `text/markdown`，沿用
   `ASSET_TEXT_MAX_CHARACTERS` 截断保证有界），`asset_versions.extracted_text`
   同事务双写 md 内容（兼容现有读路径）；`content_list_v2` 本轮存对象存储
   （同身份派生 json，不新增 DB 字段，"开发中"格式风险不扩散），后续判分需要
   DB 化时再过 ADR。**本轮不保留 images/ 目录**（仅 md + 结构化块，图片需求
   后续迭代）。
4. **降级与失败语义**：所有 mineru 确定性失败（服务不可达/轮询超时/转换失败/
   结果损坏/配置非法）都降级到现有纯文本抽取（unpdf/mammoth，成本低）；纯文本
   成功则 job `succeeded`（mineru 环节码与降级事实记日志），纯文本也失败才
   job `failed` + 纯文本稳定码。语义层次：**DB 的 failure_code = 最终结果的
   失败原因；mineru 环节码只进日志**（见"可追溯性"）。不预检 health——连接
   失败自然走降级，减少每次任务的额外 RTT。
5. **配置**：`MINERU_API_BASE_URL` 环境变量（本地 `http://127.0.0.1:8001`，
   服务器 `http://127.0.0.1:8000`；本地因镜像网络模式与 Windows 桌面端共享
   localhost 故用 8001）。
6. **部署形态**：mineru-api 绑定回环地址，仅内网访问；模型离线预下载
   （`MINERU_MODEL_SOURCE=local`），并发起步 1 防 OOM。
7. **支持面扩展**：`supportsTextExtraction` 与上传 mime 白名单新增 pptx/xlsx
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
  上传文件大小上限由 Node 侧控制。
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

## 验证方式

- 部署机（服务器/本地）实测：`curl /health` 返回 healthy；真实含公式 PDF/docx
  转换产出 md + content_list_v2（已分别于服务器 2080 Ti 与本地 5070 Ti 通过）。
- worker 集成后：上传 docx/PDF（含公式样本）→ 落库 md，前端 `source.markdown`
  渲染器零改动可打开；`pdf_text_unavailable` 语义保留（扫描件明确走 pipeline OCR）。
- 降级验证：停掉 mineru-api 后上传文档，确认走纯文本降级路径且失败码诚实。
