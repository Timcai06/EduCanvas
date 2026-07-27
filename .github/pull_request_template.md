## Description

<!-- Brief description of what this PR does -->

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)

## Invariants

<!-- What invariants does this change preserve? -->

- [ ] Security boundaries remain closed
- [ ] Data consistency maintained
- [ ] API contracts preserved
- [ ] No cross-tenant data leakage

## Compatibility

- [ ] Backward compatible
- [ ] Forward compatible
- [ ] Requires migration
- [ ] Requires documentation update

## Database Changes

- [ ] No database changes
- [ ] Schema migration added
- [ ] Data migration required
- [ ] Rollback plan documented

## Permissions

- [ ] No permission changes
- [ ] New permissions added (document scope)
- [ ] Permissions removed (document impact)

## Failure Injection

<!-- How was this change tested under failure conditions? -->

- [ ] Network failure scenarios
- [ ] Database unavailability
- [ ] Provider timeout/error
- [ ] Invalid input handling

## Evidence

<!-- What evidence supports this change? -->

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] E2E tests added/updated
- [ ] Manual testing performed

## Fallback

- [ ] Feature flag available
- [ ] Rollback plan documented
- [ ] No fallback needed

## Testing

<!-- Describe the tests you ran to verify your changes -->

```bash
# List test commands run
pnpm lint
pnpm typecheck
pnpm test:unit
```

## Checklist

- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
