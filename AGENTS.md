# EduCanvas repository guidance

## Entry points

- `apps/web` is the Next.js browser application and compatibility BFF.
- `apps/gateway` owns the `gateway.v1` HTTP composition root.
- `apps/worker` runs durable background jobs.
- `packages/agent-runtime` owns the single Agent loop; do not create a second loop in a feature package.
- `packages/model-gateway` is the only provider-adapter boundary. Provider SDK types, raw responses, and secrets stop there.
- `packages/db` owns Drizzle schema, migrations, and repositories.

## Invariants

- Treat provider responses as untrusted input and validate them before producing domain events.
- Never expose provider keys, raw provider bodies, prompts, or stack traces to browser responses.
- Local development diagnostics may contain stable error codes and provider names, but no secrets or response bodies.
- Windows startup state belongs to the repository root and must never stop processes outside the recorded EduCanvas process tree.
- Do not edit generated `.next`, `dist`, or migration output by hand.

## Commands

- `pnpm env:check` validates the local `.env` without printing secrets.
- `pnpm lint` runs workspace lint plus repository-wide Prettier coverage.
- `pnpm typecheck` runs all workspace type checks.
- `pnpm test:tooling` runs cross-platform boundary tests.
- `pnpm setup:local` installs dependencies, starts PostgreSQL, and migrates.
- On Windows, use `Start EduCanvas.cmd` and `Stop EduCanvas.cmd`; see the Windows section in `README.md`.

## Comments and changes

- Add comments for causal constraints, security boundaries, platform differences, caching decisions, and compatibility behavior.
- Do not comment obvious syntax or duplicate the implementation in prose.
- Keep public module/class/function documentation consistent with nearby JSDoc and explain side effects and failure behavior.
