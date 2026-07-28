# Release Gate Definitions

## Gate Overview

This document defines the standardized CI gates used throughout the EduCanvas release process. Each gate has a machine-readable output format and clear entry/exit criteria.

## Gate Names

| Gate | Description | Scope |
|------|-------------|-------|
| `lint` | Code style and formatting checks | Per PR |
| `typecheck` | TypeScript type checking | Per PR |
| `unit` | Unit tests | Per PR |
| `db-integration` | Database integration tests | Per PR |
| `worker-integration` | Worker process integration tests | Per PR |
| `build` | Production build verification | Per PR |
| `e2e` | End-to-end browser tests | Per PR |
| `security` | Secret scanning and security checks | Per PR |
| `contract` | API contract tests | Per Wave |
| `eval` | Agent evaluation suites | Per Wave |
| `provider-smoke` | Real provider validation | Per RC |
| `release-evidence` | Evidence pack validation | Per RC |

## Gate Scope

### Per PR (Required)
- `lint`
- `typecheck`
- `unit`
- `db-integration` (if DB changes)
- `worker-integration` (if Worker changes)
- `build`
- `security`

### Per Wave (Required)
- `e2e`
- `contract`
- `eval`

### Per RC (Required)
- All gates above
- `provider-smoke`
- `release-evidence`

## Machine-Readable Output Format

Each gate produces a JSON output file with standardized structure:

```json
{
  "gate": "gate-name",
  "status": "passed|failed|skipped",
  "timestamp": "2026-07-27T12:00:00Z",
  "duration_ms": 12345,
  "output": "path/to/output.json",
  "summary": {
    "total": 100,
    "passed": 99,
    "failed": 1,
    "skipped": 0
  },
  "artifacts": [
    {
      "name": "test-results",
      "path": "output/test-results.json"
    }
  ]
}
```

### Gate-Specific Output

#### `lint`
```json
{
  "gate": "lint",
  "status": "passed",
  "summary": {
    "files_checked": 150,
    "issues_found": 0
  }
}
```

#### `typecheck`
```json
{
  "gate": "typecheck",
  "status": "passed",
  "summary": {
    "packages_checked": 22,
    "errors": 0
  }
}
```

#### `unit`
```json
{
  "gate": "unit",
  "status": "passed",
  "summary": {
    "total": 150,
    "passed": 150,
    "failed": 0,
    "skipped": 0
  },
  "coverage": {
    "lines": 85.5,
    "functions": 82.3,
    "branches": 78.9
  }
}
```

#### `security`
```json
{
  "gate": "security",
  "status": "passed",
  "summary": {
    "secrets_found": 0,
    "history_scanned": true
  }
}
```

#### `eval`
```json
{
  "gate": "eval",
  "status": "passed",
  "summary": {
    "suite": "retrieval-quality",
    "total": 50,
    "passed": 48,
    "failed": 2,
    "metrics": {
      "recall_at_5": 0.92,
      "mrr": 0.85
    }
  }
}
```

## Exit Criteria

### Gate Pass Criteria
- All required gates must have status `passed`
- No gate may have status `failed`
- Skipped gates must be explicitly approved

### Release Evidence Pass Criteria
- Manifest validation passes
- All evidence files exist
- All signoffs collected
- Budget limits not exceeded

## Failure Handling

### PR Level
- Failed gates block merge
- Must fix before re-running

### Wave Level
- Failed gates block wave progression
- May require rollback

### RC Level
- Any failed gate blocks release
- Must resolve or explicitly accept risk
