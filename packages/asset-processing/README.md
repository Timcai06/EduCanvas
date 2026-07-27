# @educanvas/asset-processing

来源文件的文本抽取。**字节进，结构化文本出**——本包不读数据库、不碰对象存储、不做鉴权，
调用方负责在调用前完成归属校验，并把返回值落成新的文本 representation。

单独成包的原因见 [ADR-0010](../../docs/09-decisions/0010-资产解析异步化与解析器归位.md)：
解析器原本住在 `apps/web`，而 `apps/worker` 只依赖 `packages/*`，够不到它们；
`unpdf` 与 `mammoth` 这两个重依赖也不该扩散到 `agent-runtime` 之类的通用运行时里。

## 核心文件

- `src/text-extraction.ts` — PDF（unpdf）、DOCX（mammoth）、Markdown/TXT 三条抽取路径，
  以及稳定失败码 `AssetExtractionFailureCode`
- `src/index.ts` — 公开出口

## 常用命令

```bash
pnpm --filter @educanvas/asset-processing test
pnpm --filter @educanvas/asset-processing typecheck
```

## 改动前必读

- [ADR-0010：资产解析异步化与解析器归位](../../docs/09-decisions/0010-资产解析异步化与解析器归位.md)
- [数据设计](../../docs/04-data/data-design.md) 中 `asset_versions` 与 `asset_processing_jobs` 两节

## 两个容易踩的约束

**失败码只能追加，不能改写含义。** 它们会落进 `asset_processing_jobs.failure_code`
与 `asset_versions.failure_code`，并被 HTTP 层映射成用户文案，改含义会让历史记录说谎。

**DOCX 的 MIME 是内部归一化值**（不带 `.document` 后缀），与浏览器上报的标准 MIME
不同。两者同时存在是有意的——`accept` 属性用标准值、服务端检测与存储用内部值——
"对齐"其中一处会让文件筛选或类型检测静默失效。
