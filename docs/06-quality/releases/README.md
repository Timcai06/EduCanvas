# Release Evidence

This directory contains the canonical release evidence for EduCanvas releases.

## Structure

```
docs/06-quality/releases/
├── rc1/
│   ├── manifest.json           # Release manifest with all gate results
│   ├── manifest.schema.json    # JSON Schema for manifest validation
│   ├── evidence/               # Individual evidence files
│   │   ├── baseline.json
│   │   ├── gates.json
│   │   ├── eval.json
│   │   ├── dogfood.json
│   │   └── drills.json
│   └── README.md               # This file
├── rc2/
│   └── ...
└── v1.0/
    └── ...
```

## Usage

### Validating Evidence Pack

```bash
# Validate RC1 evidence pack
node tooling/quality/validate-evidence.mjs

# Validate custom manifest
node tooling/quality/validate-evidence.mjs path/to/manifest.json
```

### CI Integration

The `release-evidence` job records a non-terminal snapshot for affected pull requests.
Release-time terminal validation runs via workflow dispatch:

```bash
# Trigger release evidence validation
gh workflow run ci.yml -f release_evidence=true
```

## Manifest Fields

### Required Fields

- `release`: Release identifier (e.g., "rc1")
- `version`: Semantic version
- `status`: Overall status
- `baseline.sha`: Git SHA of baseline commit
- `gates`: Gate results

### Optional Fields

- `migration`: Database migration status
- `provider`: Provider configuration summary
- `eval`: Evaluation results
- `budget`: Cost and latency budgets
- `risks`: Known risks
- `signoffs`: Approval signatures

## Gate Results

Each gate in the manifest follows this structure:

```json
{
  "status": "passed|failed|pending",
  "timestamp": "ISO 8601 timestamp",
  "output": "path/to/output.json",
  "summary": {}
}
```

## Evidence Files

Evidence files contain detailed results for each gate:

- `baseline.json`: Git state and dependency hashes
- `gates.json`: Aggregated CI gate results
- `eval.json`: Agent evaluation metrics
- `dogfood.json`: Real provider validation results
- `drills.json`: Failure drill results

## Release Process

1. Create release branch
2. Run all required gates
3. Populate manifest with results
4. Collect evidence files
5. Obtain signoffs
6. Validate evidence pack
7. Make release decision
