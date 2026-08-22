SHELL := /bin/sh
.DEFAULT_GOAL := help

REPO_ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
PORT ?= 3000
PLAYWRIGHT_PORT ?= 3100
EDUCANVAS_POSTGRES_PORT ?= 5434
export EDUCANVAS_POSTGRES_PORT

TEST_DATABASE_URL ?= postgresql://educanvas:educanvas@127.0.0.1:$(EDUCANVAS_POSTGRES_PORT)/educanvas_integration
E2E_DATABASE_URL ?= postgresql://educanvas:educanvas@127.0.0.1:$(EDUCANVAS_POSTGRES_PORT)/educanvas_e2e
RUNTIME := node tooling/local/local-orchestrator.mjs
COMPOSE := node tooling/local/local-compose.mjs
ENV_REQUIRED := test -f .env || { printf '%s\n' '缺少 .env，请运行 pnpm env:init'; exit 1; }
LOG_FILTER_ENV := SERVICE=$(SERVICE) LEVEL=$(LEVEL) EVENT=$(EVENT) OP=$(OP) TRACE=$(TRACE) JOB=$(JOB)

include $(REPO_ROOT)tooling/make/help.mk
include $(REPO_ROOT)tooling/make/runtime.mk
include $(REPO_ROOT)tooling/make/quality.mk
include $(REPO_ROOT)tooling/make/database.mk
