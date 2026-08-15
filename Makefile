SHELL := /bin/sh
.DEFAULT_GOAL := help

PORT ?= 3101
PLAYWRIGHT_PORT ?= 3100
EDUCANVAS_POSTGRES_PORT ?= 5434
export EDUCANVAS_POSTGRES_PORT
TEST_DATABASE_URL ?= postgresql://educanvas:educanvas@127.0.0.1:$(EDUCANVAS_POSTGRES_PORT)/educanvas_integration
E2E_DATABASE_URL ?= postgresql://educanvas:educanvas@127.0.0.1:$(EDUCANVAS_POSTGRES_PORT)/educanvas_e2e

# 统一启动事实源：Makefile 只做薄入口，启动/日志/状态/停止逻辑都在
# tooling/local-orchestrator.mjs（跨平台）。.env 由 orchestrator 加载，
# 且不覆盖 shell/CI 已显式设置的变量。
RUNTIME := node tooling/local-orchestrator.mjs
LOG_FILTER_ENV := SERVICE=$(SERVICE) LEVEL=$(LEVEL) EVENT=$(EVENT) OP=$(OP) TRACE=$(TRACE) JOB=$(JOB)

.PHONY: help doctor deps setup all all-verbose dev dev-ui tui pet status stop stop-core stop-db \
	logs logs-json logs-errors check lint typecheck test build \
	db-up db-migrate db-logs db-integration-prepare db-e2e-prepare \
	integration e2e

help:
	@printf '%s\n' \
		'EduCanvas 本地开发命令' \
		'' \
		'  make setup        安装依赖、启动数据库并执行迁移' \
		'  make all          启动全部服务（默认安静：阶段摘要 ≤20 行）' \
		'  make all-verbose  详细启动：实时 pretty 运行日志 + JSONL' \
		'  make dev          启动 Web 验证环境并打开浏览器（PORT 默认 3101）' \
		'  make dev-ui       使用 Turbo TUI 观察原始 task 日志' \
		'  make tui          启动所需服务并进入交互式 TUI' \
		'  make pet          启动桌宠（先 make all，另开终端运行）' \
		'  make status       查看 Database/Gateway/Web/Worker/Runtime 状态' \
		'  make logs         查看当前运行会话日志（SERVICE/LEVEL/EVENT/OP/TRACE/JOB 可过滤；TAIL=100 只看最近 N 条；NO_FOLLOW=1 首屏后退出）' \
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
		'可覆盖变量：PORT=3000 PLAYWRIGHT_PORT=3100 EDUCANVAS_POSTGRES_PORT=5435' \
		'logs 过滤示例：make logs SERVICE=worker LEVEL=warn OP=<operation-id> TAIL=100'

doctor:
	@command -v node >/dev/null
	command -v pnpm >/dev/null
	command -v docker >/dev/null
	test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@node tooling/node-runtime-check.mjs
	@pnpm node:gate >/dev/null
	@pnpm env:check .env
	docker info >/dev/null
	printf 'Node %s · pnpm %s · Docker 已连接 · 环境变量已加载\n' "$$(node --version)" "$$(pnpm --version)"

deps:
	@pnpm install --frozen-lockfile

setup: deps db-up db-migrate
	@printf '%s\n' 'EduCanvas 本地依赖已准备完成'

all:
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@PORT=$(PORT) $(RUNTIME) all

all-verbose:
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@PORT=$(PORT) $(RUNTIME) all-verbose

dev:
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@PORT=$(PORT) $(RUNTIME) web

dev-ui:
	@pnpm dev:core

tui:
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@PORT=$(PORT) $(RUNTIME) tui

# 桌宠是 GUI 进程，不在 orchestrator 的进程树里：先 make all 再另开终端 make pet。
pet:
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@pnpm --dir apps/desktop dev

logs:
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@PORT=$(PORT) $(LOG_FILTER_ENV) $(RUNTIME) logs

logs-json:
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@PORT=$(PORT) $(LOG_FILTER_ENV) LOGS_JSON=1 $(RUNTIME) logs

logs-errors:
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@PORT=$(PORT) $(LOG_FILTER_ENV) LOGS_ERRORS=1 $(RUNTIME) logs

status:
	@PORT=$(PORT) $(RUNTIME) status

stop:
	@$(RUNTIME) stop

stop-core:
	@$(RUNTIME) stop-core

stop-db:
	@$(RUNTIME) stop-db

lint:
	@pnpm lint

typecheck:
	@pnpm typecheck

test:
	@pnpm test:unit

check:
	@pnpm lint
	pnpm typecheck
	pnpm test:unit

build:
	@pnpm build

db-up:
	@pnpm db:up

db-migrate: db-up
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@pnpm db:migrate

db-logs:
	@docker compose logs -f db

db-integration-prepare: db-up
	@if ! docker compose exec -T db psql -U educanvas -d postgres -tAc "select 1 from pg_database where datname = 'educanvas_integration'" | grep -qx 1; then \
		docker compose exec -T db createdb -U educanvas educanvas_integration; \
	fi

db-e2e-prepare: db-up
	@if ! docker compose exec -T db psql -U educanvas -d postgres -tAc "select 1 from pg_database where datname = 'educanvas_e2e'" | grep -qx 1; then \
		docker compose exec -T db createdb -U educanvas educanvas_e2e; \
	fi

integration: deps db-integration-prepare
	@TEST_DATABASE_URL=$(TEST_DATABASE_URL) pnpm test:integration

e2e: deps db-e2e-prepare
	@DATABASE_URL=$(E2E_DATABASE_URL) pnpm db:migrate
	@DATABASE_URL=$(E2E_DATABASE_URL) pnpm --filter @educanvas/web build
	@pnpm --filter @educanvas/worker build
	E2E_DATABASE_URL=$(E2E_DATABASE_URL) PLAYWRIGHT_PORT=$(PLAYWRIGHT_PORT) pnpm test:e2e
