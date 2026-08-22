.PHONY: help

help:
	@printf '%s\n' \
		'EduCanvas 本地开发命令' \
		'' \
		'  make setup        安装依赖、启动数据库并执行迁移' \
		'  make all          启动全部服务（默认安静：阶段摘要 ≤20 行）' \
		'  make all-verbose  详细启动：实时 pretty 运行日志 + JSONL' \
		'  make dev          启动 Web 验证环境并打开浏览器（PORT 默认 3000）' \
		'  make dev-ui       使用 Turbo TUI 观察原始 task 日志' \
		'  make tui          启动所需服务并进入交互式 TUI' \
		'  make pet          启动桌宠（先 make all，另开终端运行）' \
		'  make mineru       启动 MinerU 结构化转换服务' \
		'  make mineru-status  查看 MinerU 服务状态' \
		'  make mineru-stop  停止 MinerU 服务' \
		'  make status       查看 Database/Gateway/Web/Worker/Runtime 状态' \
		'  make logs         查看当前运行会话日志' \
		'  make logs-json    原始 JSONL 输出' \
		'  make logs-errors  只显示 error/fatal' \
		'  make stop         优雅停止当前 core 并停止数据库容器' \
		'  make stop-core    只停止当前 core 进程' \
		'  make stop-db      只停止数据库容器' \
		'  make doctor       检查 Node、pnpm、Docker 与本地环境文件' \
		'  make check        运行 lint、类型检查和单元测试' \
		'  make build        执行生产构建' \
		'  make integration  准备隔离数据库并运行 PostgreSQL 集成测试' \
		'  make e2e          准备隔离数据库并运行 Playwright E2E' \
		'  make db-logs      持续查看 PostgreSQL 日志' \
		'' \
		'可覆盖变量：PORT=3101 PLAYWRIGHT_PORT=3100 EDUCANVAS_POSTGRES_PORT=5435' \
		'logs 过滤示例：make logs SERVICE=worker LEVEL=warn OP=<operation-id> TAIL=100'
