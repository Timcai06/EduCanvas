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

function value(name) {
  return (values.get(name) ?? '').trim();
}

function fail(message) {
  console.error(`[env-check] ${message}`);
  process.exit(1);
}

function requireValue(name, missing) {
  const current = value(name);
  if (current === '' || current.startsWith('<your-')) missing.push(name);
  return current;
}

function parseBoolean(name) {
  const current = value(name);
  if (current === '') return false;
  if (current === 'true') return true;
  if (current === 'false') return false;
  fail(`${name} must be true or false`);
}

function validateInteger(name, min, max) {
  const current = value(name);
  if (current === '') return;
  const parsed = Number(current);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    fail(`${name} must be an integer between ${min} and ${max}`);
  }
}

function validateModelId(name) {
  const current = value(name);
  if (current === '') return;
  if (current.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(current)) {
    fail(`${name} is not a valid model id`);
  }
}

function validateBaseUrl(provider, deploymentEnvironment) {
  const raw = value('MODEL_GATEWAY_BASE_URL');
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('MODEL_GATEWAY_BASE_URL is not a valid URL');
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !['http:', 'https:'].includes(url.protocol)
  ) {
    fail(
      'MODEL_GATEWAY_BASE_URL must be http(s) without credentials, query, or fragment',
    );
  }
  if (
    ['staging', 'production'].includes(deploymentEnvironment) &&
    url.protocol !== 'https:'
  ) {
    fail('MODEL_GATEWAY_BASE_URL must use https in staging/production');
  }
  if (
    provider === 'deepseek' &&
    (url.protocol !== 'https:' || url.hostname !== 'api.deepseek.com')
  ) {
    fail('DeepSeek must use https://api.deepseek.com');
  }
}

const required = ['DATABASE_URL'];
const provider = value('MODEL_GATEWAY_PROVIDER');
const model = value('MODEL_GATEWAY_PRIMARY_MODEL');
const apiKey = value('MODEL_GATEWAY_API_KEY');
const baseUrl = value('MODEL_GATEWAY_BASE_URL');
if (provider || model || apiKey || baseUrl) {
  required.push(
    'EDUCANVAS_DEPLOYMENT_ENV',
    'MODEL_GATEWAY_PROVIDER',
    'MODEL_GATEWAY_PRIMARY_MODEL',
    'MODEL_GATEWAY_API_KEY',
    'MODEL_GATEWAY_BASE_URL',
  );
}

const missing = [];
for (const name of required) requireValue(name, missing);
if (missing.length > 0) {
  fail(`missing values: ${missing.join(', ')}`);
}

const deploymentEnvironment = value('EDUCANVAS_DEPLOYMENT_ENV') || 'local';
if (
  ![
    'local',
    'development',
    'shared-dev',
    'test',
    'staging',
    'production',
  ].includes(deploymentEnvironment)
) {
  fail('EDUCANVAS_DEPLOYMENT_ENV is not valid');
}
if (provider) {
  if (!['deepseek', 'openai-compatible'].includes(provider)) {
    fail('MODEL_GATEWAY_PROVIDER is not valid');
  }
  const runtime = value('MODEL_GATEWAY_RUNTIME') || 'native';
  if (!['native', 'ai-sdk'].includes(runtime)) {
    fail('MODEL_GATEWAY_RUNTIME must be native or ai-sdk');
  }
  if (
    provider === 'deepseek' &&
    ['staging', 'production'].includes(deploymentEnvironment)
  ) {
    fail('DeepSeek is disabled in staging/production');
  }
  if (
    provider === 'deepseek' &&
    !parseBoolean('MODEL_GATEWAY_ALLOW_DEEPSEEK')
  ) {
    fail('MODEL_GATEWAY_ALLOW_DEEPSEEK must be true when DeepSeek is selected');
  }
  if (apiKey.length > 4_096 || !/^[\x21-\x7e]+$/.test(apiKey)) {
    fail('MODEL_GATEWAY_API_KEY has an invalid shape');
  }
  validateBaseUrl(provider, deploymentEnvironment);
}

validateModelId('MODEL_GATEWAY_PRIMARY_MODEL');
validateModelId('MODEL_GATEWAY_FAST_MODEL');
validateModelId('MODEL_GATEWAY_STRUCTURED_MODEL');
validateModelId('MODEL_GATEWAY_SPEECH_MODEL');
if (provider === 'deepseek' && value('MODEL_GATEWAY_SPEECH_MODEL')) {
  fail('DeepSeek does not support MODEL_GATEWAY_SPEECH_MODEL');
}
validateInteger('MODEL_GATEWAY_TIMEOUT_MS', 1_000, 120_000);
validateInteger('MODEL_GATEWAY_MAX_OUTPUT_TOKENS', 1, 65_536);
validateInteger('MODEL_GATEWAY_SPEECH_TIMEOUT_MS', 1_000, 180_000);
validateInteger('MODEL_GATEWAY_SPEECH_MAX_INPUT_CHARS', 80, 4_096);

console.log(
  `[env-check] OK: ${envPath} loaded; database configured; model provider ${provider || 'disabled'}`,
);
