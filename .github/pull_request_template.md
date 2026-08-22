## Goal

<!-- What observable outcome does this PR deliver? -->

## Boundary

<!-- Packages, public contracts, data and users in scope. Name the logical Owner. -->

## Evidence

<!-- Pin commands, exit codes, fixtures and any manual acceptance separately. -->

```bash
pnpm file:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

- [ ] Targeted unit/contract tests cover the changed behavior
- [ ] Required integration/E2E/desktop lanes from CI impact were run
- [ ] Manual evidence is labelled separately from automated evidence

## Rollback

<!-- Exact reversible unit, flags or compatibility path. -->

## Non-goals

<!-- What this PR deliberately does not change. -->

## Review contract

### Security and failure injection

- [ ] Public responses contain no secrets, prompts, raw Provider bodies, stack traces or internal paths
- [ ] Invalid input and relevant network, database and Provider failures were injected
- [ ] Authorization and tenant/Notebook boundaries fail closed

### Compatibility and protocols

- [ ] Public entrypoints and API/protocol compatibility are preserved or explicitly versioned
- [ ] `gateway.v1` events pass strict Schema and sequence validation
- [ ] No second Agent Loop or Provider SDK boundary was introduced

### Database

- [ ] No database change
- [ ] Or: Schema/migration, forward compatibility and rollback evidence are documented

### Change hygiene

- [ ] Package policy/Owner metadata matches the implementation
- [ ] Comments explain causal constraints rather than obvious syntax
- [ ] The diff contains no generated `.next`, `dist` or hand-edited migration output
