SHELL := /bin/sh
.DEFAULT_GOAL := help

PORT ?= 3101
PLAYWRIGHT_PORT ?= 3100
TEST_DATABASE_URL ?= postgresql://educanvas:educanvas@localhost:5432/educanvas_integration
E2E_DATABASE_URL ?= postgresql://educanvas:educanvas@localhost:5432/educanvas_e2e

.PHONY: help doctor deps setup dev stop check lint typecheck test build \
	db-up db-migrate db-logs db-integration-prepare db-e2e-prepare \
	integration e2e

help:
	@printf '%s\n' \
		'EduCanvas 本地开发命令' \
		'' \
		'  make setup        安装依赖、启动数据库并执行迁移' \
		'  make dev          加载 .env，在 PORT（默认 3101）启动开发服务' \
		'  make stop         停止本地数据库容器并保留数据卷' \
		'  make doctor       检查 Node、pnpm、Docker 与本地环境文件' \
		'  make check        运行 lint、类型检查和单元测试' \
		'  make build        执行生产构建' \
		'  make integration  准备隔离数据库并运行 PostgreSQL 集成测试' \
		'  make e2e          准备隔离数据库并运行 Playwright E2E' \
		'  make db-logs      持续查看 PostgreSQL 日志' \
		'' \
		'可覆盖变量：PORT=3000 PLAYWRIGHT_PORT=3100'

doctor:
	@command -v node >/dev/null
	command -v pnpm >/dev/null
	command -v docker >/dev/null
	test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	docker info >/dev/null
	@set -a; . ./.env; set +a; \
		test -n "$${DATABASE_URL:-}" || { printf '%s\n' 'DATABASE_URL 未设置'; exit 1; }; \
		test -n "$${MODEL_GATEWAY_API_KEY:-}" || { printf '%s\n' 'MODEL_GATEWAY_API_KEY 未设置'; exit 1; }
	printf 'Node %s · pnpm %s · Docker 已连接 · 环境变量已加载\n' "$$(node --version)" "$$(pnpm --version)"

deps:
	@pnpm install --frozen-lockfile

setup: deps db-up db-migrate
	@printf '%s\n' 'EduCanvas 本地依赖已准备完成'

dev:
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@set -a; . ./.env; set +a; pnpm --filter @educanvas/web exec next dev --port $(PORT)

stop:
	@docker compose stop

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

db-migrate:
	@test -f .env || { printf '%s\n' '缺少 .env，请复制 .env.example 后填写'; exit 1; }
	@set -a; . ./.env; set +a; pnpm db:migrate

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
	E2E_DATABASE_URL=$(E2E_DATABASE_URL) PLAYWRIGHT_PORT=$(PLAYWRIGHT_PORT) pnpm test:e2e
