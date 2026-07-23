#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';

const envPath = process.argv[2] ?? '.env';
if (!existsSync(envPath)) {
  console.error(
    `[env-check] missing ${envPath}; copy .env.example to .env first`,
  );
  process.exit(1);
}

const values = new Map();
for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (line === '' || line.startsWith('#')) continue;
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match) values.set(match[1], match[2].replace(/^['"]|['"]$/g, ''));
}

const required = ['DATABASE_URL'];
const provider = values.get('MODEL_GATEWAY_PROVIDER') ?? '';
const model = values.get('MODEL_GATEWAY_PRIMARY_MODEL') ?? '';
const apiKey = values.get('MODEL_GATEWAY_API_KEY') ?? '';
const baseUrl = values.get('MODEL_GATEWAY_BASE_URL') ?? '';
if (provider || model || apiKey || baseUrl) {
  required.push(
    'MODEL_GATEWAY_PROVIDER',
    'MODEL_GATEWAY_PRIMARY_MODEL',
    'MODEL_GATEWAY_API_KEY',
    'MODEL_GATEWAY_BASE_URL',
  );
}

const missing = required.filter((name) => {
  const value = values.get(name) ?? '';
  return value === '' || value.startsWith('<your-');
});
if (missing.length > 0) {
  console.error(`[env-check] missing values: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(
  `[env-check] OK: ${envPath} loaded; database configured; model provider ${provider || 'disabled'}`,
);
