# EduCanvas 接入 MinerU：端到端链路与已知问题

- 状态：`draft`
- 负责人：hzlgou
- 创建时间：2026-08-12
- 相关分支：`fix/20260812-pdf-preview-structured`（⊃ `docs/20260811-input-md-canvas-research`）
- 定位：**应用集成视角**（代码链路 / 契约 / 验证方法 / 已知问题），服务器部署见同目录 [`03-MinerU部署手册.md`](03-MinerU部署手册.md)；需求与技术路线见 [`02-输入文档统一md需求与技术路线.md`](02-输入文档统一md需求与技术路线.md)；实现依据为 [ADR-0026](../09-decisions/0026-多模态输入原件与派生表示边界.md)（accepted）

## 一、目标与范围

让上传到 EduCanvas 的文档（PDF/DOCX 等）经 MinerU 转为**带结构的 Markdown**，落库后提供两处消费：

1. **结构化阅读视图**：来源预览面板对 PDF/DOCX 优先展示"结构化阅读 · MinerU 派生表示"（替代 pdf.js 原样翻页）
2. **对话上下文**：Agent 引用资产时以结构 Markdown 进上下文（E 线，见 ADR-0026 决定 3/6）

本文档描述 EduCanvas 侧集成方式，供 PR 审核与后续维护使用。

## 二、端到端链路

```
网页上传 → POST /api/v1/chat/assets（挂到当前对话 space）
        → asset-processing worker（extract-asset-text 编排）
        → mineru-api（REST，端口 8000，独立进程）
        → zip 结果解包校验 → 派生存储 uploads/derived/<jobId>/index.md + images/ + manifest.json
        → asset_representations 落库（quality=structured）
        ↓
预览     GET /api/v1/chat/assets/:assetId/preview
        → asset-preview 契约校验 → 面板 source-preview-panel
        → PDF/DOCX：quality=structured 且有 markdown → 结构化阅读视图
                             否则 → 回退 pdf.js（PDF）/ mammoth（DOCX）原格式预览
```

## 三、关键组件与契约

### 3.1 mineru-client（`apps/worker`）

- `submitTask` / `waitForTask`（15 分钟上限）/ `fetchResult`（zip 解包 + 结果校验）三段式
- 错误分类总表与映射矩阵测试 100% 覆盖（fake 服务全量故障测试，G1）
- `MINERU_BASE_URL` 缺失即返回 null 走降级（`degraded_plain_text`），无默认值

### 3.2 zip 布局契约（G2 canary 实测修正）

MinerU 结果 zip **不是根级 `index.md`**，真实布局：

```
<base>/<parse_dir>/<base>.md     # parse_dir ∈ office / vlm / hybrid_auto / hybrid_<method>
<base>/<parse_dir>/images/<sha>.jpg
```

客户端 `locateMineruOutput` 识别布局，`validateMineruEntries` 归一化为派生存储路径（`index.md` / `images/<file>`），下游零改动。

### 3.3 四态质量与派生存储

- 质量枚举：`processing` / `structured` / `degraded_plain_text` / `failed`（DB CHECK 约束）
- 派生存储：`uploads/derived/<jobId>/index.md` + `images/` + `manifest.json`（producer=mineru）
- 读取侧（preview / materialization）校验 `sha256` 与 `asset_representations.checksum` 一致，不一致按"无表示"回退原格式预览，防篡改

### 3.4 预览链路（`apps/web`，本次修复范围）

| 层 | 文件 | 本次改动 |
|---|---|---|
| 契约 | `features/assets/asset-preview-contract.ts` | pdf 分支新增 `representation`（与 docx 同构）：`quality` 枚举 + `markdown`（≤120_000，可选） |
| 服务端 | `server/assets/asset-preview.ts` | pdf 分支带出 text representation；`structured` 时 `resolveStructuredMarkdown` 投影图片引用为鉴权资源 URL |
| 面板 | `features/assets/source-preview-panel.tsx` | pdf 分支优先渲染结构化阅读；无表示回退 `PdfPreview`（pdf.js） |

图片投影：`![...](images/001.jpg)` → `/api/v1/chat/assets/:assetId/resources/images/001.jpg`（D1 资源路由逐次复验权限）。

### 3.5 身份与空间语义（排障重要）

- `EDUCANVAS_DEPLOYMENT_ENV=local`（无 `LOCAL_USER_ID`）→ 服务端身份固定 `local:owner`，浏览器 cookie 被忽略 → **curl 可直接模拟用户请求**
- 资产按对话（space）隔离：上传/列表/预览都解析到**当前对话的 space**
- 两个列表端点注意区分：`/api/v1/chat/assets`（chat 域，前端实际使用，按 conversation space）与 `/api/v1/assets`（teaching target 域，需学习计划，无计划时返回 `session_not_found`）

## 四、验证方法（实跑）

```bash
# 列表（当前对话的资产）
curl -s http://127.0.0.1:3101/api/v1/chat/assets

# 预览（quality + markdown 前 80 字）
curl -s http://127.0.0.1:3101/api/v1/chat/assets/<assetId>/preview

# 资源图片（markdown 中投影后的 URL）
curl -s http://127.0.0.1:3101/api/v1/chat/assets/<assetId>/resources/images/<sha>.jpg
```

验证口径：`quality=structured` 且 `markdown` 有内容 → 链路通；`degraded_plain_text`/`failed` 按四态质量表核对对应环节（MinerU 可用性 / 解析失败）。

## 五、运行配置与排障速查

- `mineru-api` 启动：**必须从稳定 cwd（如 `/home/hzlgou`）启动**——cwd 指向已删除目录时写 output/ 失败，所有任务 HTTP 500（`mineru_submit_rejected`），已踩坑修复
- 并发：`MINERU_API_MAX_CONCURRENT_REQUESTS=1`（当前刻意保持，勿擅自提高）
- 2080 Ti 部署细节、conda 环境、模型路径、排错表：见 `03-MinerU部署手册.md`

## 六、已知问题（待负责人决策）

### 问题 A：结构化预览在浏览器端未生效（本次核心）

- **现象**：代码修复（本分支 3 提交）已部署、服务重启后，用户硬刷新页面，来源预览面板仍显示 pdf.js 翻页，未出现"结构化阅读 · MinerU 派生表示"
- **已排除**（均有实跑证据）：
  - 数据：4 条 structured 派生对象 checksum 与 DB 声明全部一致
  - 服务端：`curl` 预览接口返回 `quality=structured` + 完整 markdown
  - 会话：用户浏览器 console 直接 fetch 同一接口，返回 `quality: structured` + 完整 markdown（200）
- **未定位**：浏览器端 JS 加载/渲染层（前端组件 `source-preview-panel.tsx` 的 pdf 分支未在浏览器实际渲染出结构化视图）
- **负责人复现路径**：
  1. 本地 `make dev`（分支 `fix/20260812-pdf-preview-structured`）
  2. 当前对话上传任意 PDF，等待状态变为"已处理完成"
  3. 资产列表点开该 PDF
  4. 预期：白卡片"结构化阅读 · MinerU 派生表示"；实际：pdf.js 翻页
  5. Console 辅助确认服务端无误：`fetch('/api/v1/chat/assets/<assetId>/preview').then(r=>r.json()).then(d=>console.log(d.preview?.representation))`
- **注意**：资产按对话隔离——旧对话上传的文件在新对话 fetch 返回 404 属正常行为，验证必须使用**当前对话**上传的文件

### 问题 B：资产按对话（space）隔离，新对话看不到旧文件

- 现象：用户新开对话后，资产列表只显示新对话内上传的文件；旧对话上传的 PDF 在新对话 preview 返回 404（本次用户"看不见"的直接根因之一）
- 现状：这是**当前设计语义**（assets.space_id = 上传时对话的 space；上传/列表/预览三处一致）
- 待决策：是否需要"上传过的文件跨对话可见"（per-user 语义）？涉及安全模型（匿名身份、空间隔离边界），若改需新 ADR

### 问题 C：上传时偶现"无法添加文件系统：<illegal path>"

- 现象：用户上传操作时页面出现该提示，来源未知（疑似浏览器 File System Access API 相关）
- 状态：待查，与 MinerU 集成无直接关联，记录备查
