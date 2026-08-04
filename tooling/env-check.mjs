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

/**
 * 能力 override 的 Base URL 校验，与主 Provider/Vision 同源：拒绝内嵌凭据、
 * query、hash，staging/production 强制 https。能力端点不是 DeepSeek，不套用
 * hostname 白名单（ADR-0021）。
 */
function validateCapabilityBaseUrl(capability, deploymentEnvironment) {
  const name = `MODEL_GATEWAY_${capability}_BASE_URL`;
  const raw = value(name);
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${name} is not a valid URL`);
  }
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !['http:', 'https:'].includes(url.protocol)
  ) {
    fail(`${name} must be http(s) without credentials, query, or fragment`);
  }
  if (
    ['staging', 'production'].includes(deploymentEnvironment) &&
    url.protocol !== 'https:'
  ) {
    fail(`${name} must use https in staging/production`);
  }
}

/**
 * 解析媒体能力 override（ADR-0021）。
 *
 * 显式声明 `MODEL_GATEWAY_<CAP>_PROVIDER` 后，模型、Base URL 与 API Key 必须
 * 同组出现——半配置会让部署以为能力可用，直到运行时才失败；能力不兼容的
 * Provider（DeepSeek 无媒体能力）直接拒绝。
 *
 * 返回该能力的状态：`overridden`（独立路由）、`inherited`（继承主 Provider）、
 * `disabled`（未配置或主 Provider 不支持）。
 */
function validateCapabilityOverride(capability, provider) {
  const capProvider = value(`MODEL_GATEWAY_${capability}_PROVIDER`);
  const capModel = value(`MODEL_GATEWAY_${capability}_MODEL`);
  const capBaseUrl = value(`MODEL_GATEWAY_${capability}_BASE_URL`);
  const capApiKey = value(`MODEL_GATEWAY_${capability}_API_KEY`);

  validateModelId(`MODEL_GATEWAY_${capability}_MODEL`);

  if (capProvider === '') {
    /* 未声明 override：主 Provider 明确支持才允许整组继承（ADR-0021 继承链）。 */
    if (provider === 'openai-compatible' && capModel) {
      return 'inherited';
    }
    return 'disabled';
  }
  if (capProvider !== 'openai-compatible') {
    fail(`MODEL_GATEWAY_${capability}_PROVIDER is not valid`);
  }
  const missing = [];
  requireValue(`MODEL_GATEWAY_${capability}_MODEL`, missing);
  requireValue(`MODEL_GATEWAY_${capability}_BASE_URL`, missing);
  requireValue(`MODEL_GATEWAY_${capability}_API_KEY`, missing);
  if (missing.length > 0) {
    fail(`missing ${capability} override values: ${missing.join(', ')}`);
  }
  const capKeyShape = value(`MODEL_GATEWAY_${capability}_API_KEY`);
  if (capKeyShape.length > 4_096 || !/^[\x21-\x7e]+$/.test(capKeyShape)) {
    fail(`MODEL_GATEWAY_${capability}_API_KEY has an invalid shape`);
  }
  validateCapabilityBaseUrl(capability, deploymentEnvironment);
  return 'overridden';
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
validateInteger('MODEL_GATEWAY_TIMEOUT_MS', 1_000, 120_000);
validateInteger('MODEL_GATEWAY_MAX_OUTPUT_TOKENS', 1, 65_536);
validateInteger('MODEL_GATEWAY_SPEECH_TIMEOUT_MS', 1_000, 180_000);
validateInteger('MODEL_GATEWAY_SPEECH_MAX_INPUT_CHARS', 80, 4_096);
validateInteger('MODEL_GATEWAY_TRANSCRIPTION_TIMEOUT_MS', 5_000, 300_000);
validateInteger(
  'MODEL_GATEWAY_TRANSCRIPTION_MAX_INPUT_BYTES',
  1024,
  50 * 1024 * 1024,
);
validateInteger('MODEL_GATEWAY_IMAGE_TIMEOUT_MS', 5_000, 300_000);
validateInteger('MODEL_GATEWAY_IMAGE_MAX_OUTPUT_BYTES', 1024, 20 * 1024 * 1024);
validateInteger('MODEL_GATEWAY_EMBEDDING_TIMEOUT_MS', 1_000, 180_000);
validateInteger('MODEL_GATEWAY_EMBEDDING_MAX_BATCH', 1, 256);

/* 媒体能力状态（ADR-0021）：声明 override 必须配置组完整，否则只关该能力。 */
const capabilityStates = {};
for (const capability of ['SPEECH', 'TRANSCRIPTION', 'IMAGE', 'EMBEDDING']) {
  capabilityStates[capability] = validateCapabilityOverride(
    capability,
    provider,
  );
  if (capability === 'EMBEDDING' && capabilityStates.EMBEDDING !== 'disabled') {
    /* 配置了 embedding 模型或 override 就必须声明版本：向量可比较性完全依赖它。 */
    const embeddingMissing = [];
    requireValue('MODEL_GATEWAY_EMBEDDING_MODEL_VERSION', embeddingMissing);
    if (embeddingMissing.length > 0) {
      fail(
        'MODEL_GATEWAY_EMBEDDING_MODEL_VERSION is required when embedding is configured',
      );
    }
  }
}

/*
 * 视觉 Provider：配置了模型就必须给齐 Base URL 与 Key。半配置状态会让部署以为
 * 图片可用，直到学生真传了一张图才在 Turn 中途失败（ADR-0017）。
 */
const visionModel = value('MODEL_GATEWAY_VISION_MODEL');
if (visionModel) {
  validateModelId('MODEL_GATEWAY_VISION_MODEL');
  if (parseBoolean('MODEL_GATEWAY_VISION')) {
    fail(
      'MODEL_GATEWAY_VISION and MODEL_GATEWAY_VISION_MODEL are mutually exclusive',
    );
  }
  const visionMissing = [];
  requireValue('MODEL_GATEWAY_VISION_BASE_URL', visionMissing);
  requireValue('MODEL_GATEWAY_VISION_API_KEY', visionMissing);
  if (visionMissing.length > 0) {
    fail(`missing vision provider values: ${visionMissing.join(', ')}`);
  }
  const visionKey = value('MODEL_GATEWAY_VISION_API_KEY');
  if (visionKey.length > 4_096 || !/^[\x21-\x7e]+$/.test(visionKey)) {
    fail('MODEL_GATEWAY_VISION_API_KEY has an invalid shape');
  }
  validateCapabilityBaseUrl('VISION', deploymentEnvironment);
}
validateInteger('MODEL_GATEWAY_VISION_TIMEOUT_MS', 5_000, 300_000);
validateInteger('MODEL_GATEWAY_VISION_MAX_OUTPUT_TOKENS', 1, 65_536);

const capabilitySummary = Object.entries(capabilityStates)
  .map(([capability, state]) => `${capability.toLowerCase()}=${state}`)
  .join(' ');
console.log(
  `[env-check] OK: ${envPath} loaded; database configured; model provider ${provider || 'disabled'}; capabilities ${capabilitySummary}`,
);
