import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export const F5_POLICY_PATH = 'scripts/kern-frontend-f5-projection/policy.json';
export const ASSET_MANIFEST_PATH = 'packages/core/dist/frontend-projection-assets/assets.json';

export const BASE_WORK_STEPS = 33_554_432;
export const RAISED_WORK_STEPS = 100_663_296;

export const SCHEDULER_TIMEOUT_MS = 120_000;
export const CENSUS_HARNESS_TIMEOUT_MS = 300_000;

export const BASE_ADMITTED_DIGEST = '056556a92e8c12cba747ac862f02db411d1444473836859207fb02a2a4b85046';
export const BASE_ADMISSION_DIGEST = 'e5135d13dd3ae703c7765f13e318c6336dbd3b771c99ce07cb9e44abd0f4b508';

export const BASE_PROFILE_LIMITS = Object.freeze({
  maxModules: 256,
  maxInstructionScalars: 16_777_216,
  maxWorkSteps: BASE_WORK_STEPS,
  maxNodes: 1_048_576,
  maxDepth: 256,
  maxCollectionLength: 262_144,
  maxStringCodePoints: 16_777_216,
});

export const BASE_RUNTIME_LIMITS = Object.freeze({
  maxBytes: 33_554_432,
  maxCollectionLength: 1_048_576,
  maxDepth: 512,
  maxDiagnostics: 8,
  maxEvents: 1,
  maxIterations: BASE_WORK_STEPS,
  maxStringBytes: 33_554_432,
});

export const BASE_CANONICAL_LIMITS = Object.freeze({
  maxBytes: 16_777_216,
  maxCollectionLength: 262_144,
  maxDecimalChars: 128,
  maxDepth: 256,
  maxFractionDigits: 64,
  maxIntegerDigits: 512,
  maxMapEntries: 262_144,
  maxNodes: 1_048_576,
  maxRecordFields: 262_144,
  maxStringBytes: 16_777_216,
});

export const RAISED_KEYS = Object.freeze(['profileLimits.maxWorkSteps', 'runtimeLimits.maxIterations']);

export const bytes = (path) => readFileSync(resolve(REPO_ROOT, path));

export const text = (path) => bytes(path).toString('utf8');

export const json = (path) => JSON.parse(text(path));

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const policy = () => json(F5_POLICY_PATH);

export function assetManifest() {
  try {
    return json(ASSET_MANIFEST_PATH);
  } catch (error) {
    throw new Error(
      `${ASSET_MANIFEST_PATH} is unreadable — run scripts/build-kern-frontend-projection-assets.mjs first: ${
        String(error?.message ?? error)}`,
    );
  }
}

export function movedKeys(shipped, section, baseline) {
  return Object.keys(baseline)
    .filter((key) => shipped[section][key] !== baseline[key])
    .map((key) => `${section}.${key}`);
}

export function smallModule() {
  return [{ moduleId: 'limit.kern', source: 'fn name=limit export=true\n' }];
}
