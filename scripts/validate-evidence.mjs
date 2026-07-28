#!/usr/bin/env node

/**
 * Release Evidence Pack Validator
 *
 * Validates that the release evidence pack contains all required fields,
 * links, and result files. Used in CI to gate RC releases.
 *
 * Usage:
 *   node scripts/validate-evidence.mjs [manifest-path]
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - Validation failed
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const manifestPath = process.argv[2] || resolve(repoRoot, 'docs/06-quality/releases/rc1/manifest.json');

function loadJSON(path) {
  if (!existsSync(path)) {
    console.error(`❌ File not found: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    console.error(`❌ Failed to parse ${path}: ${e.message}`);
    return null;
  }
}

function validateRequiredFields(manifest) {
  const errors = [];
  const required = ['release', 'version', 'status', 'baseline', 'gates'];

  for (const field of required) {
    if (!manifest[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (manifest.baseline) {
    if (!manifest.baseline.sha) errors.push('Missing baseline.sha');
    if (!manifest.baseline.branch) errors.push('Missing baseline.branch');
    if (!manifest.baseline.timestamp) errors.push('Missing baseline.timestamp');
  }

  if (manifest.gates) {
    const requiredGates = [
      'lint', 'typecheck', 'unit', 'build', 'security', 'release-evidence'
    ];
    for (const gate of requiredGates) {
      if (!manifest.gates[gate]) {
        errors.push(`Missing gate: ${gate}`);
      } else if (!manifest.gates[gate].status) {
        errors.push(`Gate ${gate} missing status`);
      }
    }
  }

  return errors;
}

function validateEvidenceFiles(manifest) {
  const errors = [];
  const evidenceDir = resolve(repoRoot, 'docs/06-quality/releases/rc1');

  if (manifest.evidence) {
    for (const [key, path] of Object.entries(manifest.evidence)) {
      const fullPath = resolve(evidenceDir, path);
      if (!existsSync(fullPath)) {
        errors.push(`Evidence file not found: ${key} -> ${path}`);
      }
    }
  }

  return errors;
}

function validateGateStatuses(manifest) {
  const errors = [];
  const validStatuses = ['pending', 'running', 'passed', 'failed', 'skipped'];

  if (manifest.gates) {
    for (const [name, gate] of Object.entries(manifest.gates)) {
      if (!validStatuses.includes(gate.status)) {
        errors.push(`Gate ${name} has invalid status: ${gate.status}`);
      }
    }
  }

  return errors;
}

function validateTimestamps(manifest) {
  const errors = [];
  const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

  if (manifest.baseline?.timestamp && !isoRegex.test(manifest.baseline.timestamp)) {
    errors.push('baseline.timestamp is not ISO 8601 format');
  }

  if (manifest.gates) {
    for (const [name, gate] of Object.entries(manifest.gates)) {
      if (gate.timestamp && !isoRegex.test(gate.timestamp)) {
        errors.push(`Gate ${name} timestamp is not ISO 8601 format`);
      }
    }
  }

  return errors;
}

// Main validation
console.log('🔍 Validating release evidence pack...\n');
console.log(`Manifest: ${manifestPath}\n`);

const manifest = loadJSON(manifestPath);
if (!manifest) {
  process.exit(1);
}

const allErrors = [
  ...validateRequiredFields(manifest),
  ...validateEvidenceFiles(manifest),
  ...validateGateStatuses(manifest),
  ...validateTimestamps(manifest),
];

if (allErrors.length === 0) {
  console.log('✅ All validations passed!\n');

  // Summary
  console.log('Summary:');
  console.log(`  Release: ${manifest.release}`);
  console.log(`  Version: ${manifest.version}`);
  console.log(`  Status: ${manifest.status}`);
  console.log(`  Baseline: ${manifest.baseline?.sha?.slice(0, 8) || 'N/A'}`);

  if (manifest.gates) {
    const passed = Object.values(manifest.gates).filter(g => g.status === 'passed').length;
    const total = Object.keys(manifest.gates).length;
    console.log(`  Gates: ${passed}/${total} passed`);
  }

  process.exit(0);
} else {
  console.error(`❌ Validation failed with ${allErrors.length} error(s):\n`);
  for (const error of allErrors) {
    console.error(`  • ${error}`);
  }
  process.exit(1);
}
