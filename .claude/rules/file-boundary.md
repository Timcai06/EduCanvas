# 文件边界规则

- 只修改当前任务明确列出的文件，不越界
- 不修改 packages/db、Drizzle schema、migration 和学习事件写入路径
- 不触碰 Canvas、Artifact、媒体、语音、Worker、Gateway 或其他开发者文件
- 不格式化任务外文件，不 reset/restore/checkout/stash/rebase
- 发现需要越界时，立即停止并报告，不自行决定
- 新增 apps/* 或 packages/* 包必须先得到 Code Owner 批准
