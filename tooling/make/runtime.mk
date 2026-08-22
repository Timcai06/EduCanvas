.PHONY: doctor deps setup all all-verbose dev dev-ui tui pet mineru mineru-status mineru-stop status stop stop-core stop-db logs logs-json logs-errors

doctor:
	@command -v node >/dev/null
	command -v pnpm >/dev/null
	command -v docker >/dev/null
	$(ENV_REQUIRED)
	@node tooling/quality/node-runtime-check.mjs
	@pnpm node:gate >/dev/null
	@pnpm env:check .env
	docker info >/dev/null
	printf 'Node %s · pnpm %s · Docker 已连接 · 环境变量已加载\n' "$$(node --version)" "$$(pnpm --version)"

deps:
	@pnpm install --frozen-lockfile

setup: deps db-up db-migrate
	@printf '%s\n' 'EduCanvas 本地依赖已准备完成'

all:
	@$(ENV_REQUIRED)
	@PORT=$(PORT) $(RUNTIME) all

all-verbose:
	@$(ENV_REQUIRED)
	@PORT=$(PORT) $(RUNTIME) all-verbose

dev:
	@$(ENV_REQUIRED)
	@PORT=$(PORT) $(RUNTIME) web

dev-ui:
	@pnpm dev:core

tui:
	@$(ENV_REQUIRED)
	@PORT=$(PORT) $(RUNTIME) tui

pet:
	@$(ENV_REQUIRED)
	@pnpm --dir apps/desktop dev

mineru:
	@node tooling/local/local-mineru.mjs start

mineru-status:
	@node tooling/local/local-mineru.mjs status

mineru-stop:
	@node tooling/local/local-mineru.mjs stop

logs:
	@$(ENV_REQUIRED)
	@PORT=$(PORT) $(LOG_FILTER_ENV) $(RUNTIME) logs

logs-json:
	@$(ENV_REQUIRED)
	@PORT=$(PORT) $(LOG_FILTER_ENV) LOGS_JSON=1 $(RUNTIME) logs

logs-errors:
	@$(ENV_REQUIRED)
	@PORT=$(PORT) $(LOG_FILTER_ENV) LOGS_ERRORS=1 $(RUNTIME) logs

status:
	@PORT=$(PORT) $(RUNTIME) status

stop:
	@$(RUNTIME) stop

stop-core:
	@$(RUNTIME) stop-core

stop-db:
	@$(RUNTIME) stop-db
