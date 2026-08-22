.PHONY: lint typecheck test check build

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
