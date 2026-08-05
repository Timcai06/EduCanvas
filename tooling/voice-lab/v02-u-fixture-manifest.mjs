/** Canonical, fail-closed schema for the local-only V02-U human fixture. */

import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const V02_U_EXPECTED_TEXT =
  'Bagging and boosting are two classic ensemble methods. Bagging reduces variance, while boosting reduces bias.';

export const V02_U_AUTHORIZATION_STATEMENT =
  '该录音由我本人录制，允许仅用于 EduCanvas 本地 V02-U 测试证据，不随 Git 仓库发布。';

const MANIFEST_KEYS = Object.freeze([
  'audioFile',
  'authorizationStatement',
  'channels',
  'encoding',
  'expectedText',
  'sampleRate',
  'schemaVersion',
  'sha256',
  'sourceKind',
  'usageAuthorization',
]);

export function readV02UFixtureManifest(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('v02_u_fixture_manifest_unreadable');
  }
  return validateV02UFixtureManifest(value);
}

export function validateV02UFixtureManifest(value) {
  if (!isPlainObject(value)) invalid();
  const keys = Object.keys(value).sort();
  if (
    keys.length !== MANIFEST_KEYS.length ||
    keys.some((key, index) => key !== MANIFEST_KEYS[index])
  ) {
    invalid();
  }
  if (
    value.schemaVersion !== 1 ||
    value.sourceKind !== 'project-owner-recording' ||
    value.usageAuthorization !== 'local-evaluation-only' ||
    value.authorizationStatement !== V02_U_AUTHORIZATION_STATEMENT ||
    value.expectedText !== V02_U_EXPECTED_TEXT ||
    typeof value.audioFile !== 'string' ||
    isAbsolute(value.audioFile) ||
    !/^fixtures\/generated\/[a-z0-9-]+\.wav$/.test(value.audioFile) ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    value.sampleRate !== 16000 ||
    value.channels !== 1 ||
    value.encoding !== 'pcm_s16le'
  ) {
    invalid();
  }
  return Object.freeze({ ...value });
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function invalid() {
  throw new Error('v02_u_fixture_manifest_invalid');
}
