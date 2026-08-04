import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateV02SFixtureManifest,
  V02_S_AUTHORIZATION_STATEMENT,
  V02_S_EXPECTED_TEXT,
} from './v02-s-fixture-manifest.mjs';

function validManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    sourceKind: 'project-owner-recording',
    usageAuthorization: 'local-evaluation-only',
    authorizationStatement: V02_S_AUTHORIZATION_STATEMENT,
    audioFile: 'fixtures/generated/v02-s-human.wav',
    expectedText: V02_S_EXPECTED_TEXT,
    sha256: 'a'.repeat(64),
    sampleRate: 16000,
    channels: 1,
    encoding: 'pcm_s16le',
    ...overrides,
  };
}

test('accepts and freezes the canonical local-only fixture manifest', () => {
  const manifest = validateV02SFixtureManifest(validManifest());
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(manifest.expectedText, V02_S_EXPECTED_TEXT);
});

test('rejects a substituted sentence or missing owner authorization', () => {
  assert.throws(
    () => validateV02SFixtureManifest(validManifest({ expectedText: 'other' })),
    /v02_s_fixture_manifest_invalid/,
  );
  assert.throws(
    () =>
      validateV02SFixtureManifest(
        validManifest({ authorizationStatement: 'assumed' }),
      ),
    /v02_s_fixture_manifest_invalid/,
  );
});

test('rejects absolute, escaping, or untracked fixture locations', () => {
  for (const audioFile of [
    '/tmp/sample.wav',
    '../sample.wav',
    'fixtures/v02-s-human.wav',
  ]) {
    assert.throws(
      () => validateV02SFixtureManifest(validManifest({ audioFile })),
      /v02_s_fixture_manifest_invalid/,
    );
  }
});

test('rejects unexpected fields and invalid audio metadata', () => {
  assert.throws(
    () => validateV02SFixtureManifest(validManifest({ hostPath: '/tmp/x' })),
    /v02_s_fixture_manifest_invalid/,
  );
  assert.throws(
    () => validateV02SFixtureManifest(validManifest({ sampleRate: 44100 })),
    /v02_s_fixture_manifest_invalid/,
  );
});
