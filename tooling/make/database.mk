.PHONY: db-up db-migrate db-logs db-integration-prepare db-e2e-prepare integration e2e

db-up:
	@pnpm db:up

db-migrate: db-up
	@$(ENV_REQUIRED)
	@pnpm db:migrate

db-logs:
	@$(COMPOSE) logs -f db

db-integration-prepare: db-up
	@if ! $(COMPOSE) exec -T db psql -U educanvas -d postgres -tAc "select 1 from pg_database where datname = 'educanvas_integration'" | grep -qx 1; then \
		$(COMPOSE) exec -T db createdb -U educanvas educanvas_integration; \
	fi

db-e2e-prepare: db-up
	@if ! $(COMPOSE) exec -T db psql -U educanvas -d postgres -tAc "select 1 from pg_database where datname = 'educanvas_e2e'" | grep -qx 1; then \
		$(COMPOSE) exec -T db createdb -U educanvas educanvas_e2e; \
	fi

integration: deps db-integration-prepare
	@TEST_DATABASE_URL=$(TEST_DATABASE_URL) pnpm test:integration

e2e: deps db-e2e-prepare
	@DATABASE_URL=$(E2E_DATABASE_URL) pnpm db:migrate
	@DATABASE_URL=$(E2E_DATABASE_URL) pnpm --filter @educanvas/web build
	@pnpm --filter @educanvas/worker build
	E2E_DATABASE_URL=$(E2E_DATABASE_URL) PLAYWRIGHT_PORT=$(PLAYWRIGHT_PORT) pnpm test:e2e
