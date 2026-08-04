/** Verify the two predeclared V02-S model profiles and derive the shared vocab. */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectedRequiredModelHashes,
  getModelProfile,
} from './model-profiles.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const current = getModelProfile('current');
const candidate = getModelProfile('small-bilingual-fp32');
const currentDir = join(here, 'models', current.directory);
const candidateDir = join(here, 'models', candidate.directory);

verifySharedTokenizerFile(currentDir, current, 'bpe.model');
verifySharedTokenizerFile(candidateDir, candidate, 'bpe.model');
verifySharedTokenizerFile(currentDir, current, current.tokens);
verifySharedTokenizerFile(candidateDir, candidate, candidate.tokens);

const currentVocab = join(currentDir, current.bpeVocab);
const candidateVocab = join(candidateDir, candidate.bpeVocab);
verifyHash(currentVocab, current.hashes.bpeVocab);

// The official small archive omits bpe.vocab. Its bpe.model and tokens.txt are
// byte-identical to the current profile, so copying this derived vocabulary is
// deterministic and cannot silently mix different tokenizers.
if (!existsSync(candidateVocab)) copyFileSync(currentVocab, candidateVocab);

verifyProfile(currentDir, current);
verifyProfile(candidateDir, candidate);
console.log('V02-S model profiles are prepared and hash-verified.');

function verifyProfile(directory, profile) {
  for (const [filename, expectedHash] of Object.entries(
    expectedRequiredModelHashes(profile),
  )) {
    verifyHash(join(directory, filename), expectedHash);
  }
}

function verifySharedTokenizerFile(directory, profile, filename) {
  const key = filename === profile.tokens ? 'tokens' : 'bpeModel';
  verifyHash(join(directory, filename), profile.hashes[key]);
}

function verifyHash(path, expected) {
  if (!existsSync(path)) fail('A required V02-S model file is missing.');
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== expected) fail('A V02-S model file hash does not match.');
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
