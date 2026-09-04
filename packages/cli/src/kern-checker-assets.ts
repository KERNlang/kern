import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KERN_CHECKER_NATIVE_WORK_FORMULA } from './kern-checker-contract.js';
import { KERN_RUNTIME_HANDLER_LIMIT_KEYS } from './kern-runtime-limit-keys.js';

export const KERN_CHECKER_ASSET_FORMAT = 'kern.cli.checker.assets.1';
export const KERN_CHECKER_ASSET_NAMES = Object.freeze([
  'assets.json',
  'checker.composed.kern',
  'composition.json',
  'policy.json',
]);

// These release identities are compiled outside the mutable asset directory.
export const KERN_CHECKER_TRUST = Object.freeze({
  composition: { bytes: 865, sha256: '480e066c93ee7d4bfb12d5836158b94ed129a2ff636373845b0491fdd28b9e0b' },
  policy: { bytes: 864, sha256: '32d9bac2a7b8aefd6bf653047ebfade27dc11860edeb1020a72893dfe8477bab' },
  source: { bytes: 53_500, sha256: '27542f388bc08bfe049c66cec6c7cf6783d84b63492260874abde514a5da396c' },
});

export interface KernCheckerPolicy {
  readonly format: 'kern.checker.policy.1';
  readonly nativeWork: {
    readonly corpus: { readonly count: number; readonly sha256: string };
    readonly formula: typeof KERN_CHECKER_NATIVE_WORK_FORMULA;
    readonly maximumEnvelope: {
      readonly id: string;
      readonly sha256: string;
      readonly work: number;
    };
    readonly maxNativeWork: number;
  };
  readonly profileLimits: {
    readonly maxDiagnostics: number;
    readonly maxFactCells: number;
    readonly maxInputBytes: number;
    readonly maxPathBytes: number;
    readonly maxResultBytes: number;
    readonly maxRowsPerFamily: number;
  };
  readonly runtimeLimits: {
    readonly maxBytes: number;
    readonly maxCollectionLength: number;
    readonly maxDepth: number;
    readonly maxDiagnostics: number;
    readonly maxEvents: number;
    readonly maxIterations: number;
    readonly maxStringBytes: number;
  };
}

export interface KernCheckerAssets {
  readonly checker: { readonly bytes: number; readonly sha256: string };
  readonly policy: KernCheckerPolicy;
  readonly source: string;
}

function fail(detail: string): never {
  throw new TypeError(`KERN checker asset rejection: ${detail}`);
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    fail(`${label} must contain exactly ${sorted.join(',')}`);
  }
}

function positiveSafe(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) fail(`${label} must be a positive safe integer`);
}

function digestText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) fail(`${label} must be a SHA-256 digest`);
}

function validatePolicy(value: unknown): KernCheckerPolicy {
  exactKeys(value, ['format', 'nativeWork', 'profileLimits', 'runtimeLimits'], 'policy');
  if (value.format !== 'kern.checker.policy.1') fail('policy format is unsupported');
  exactKeys(value.nativeWork, ['corpus', 'formula', 'maximumEnvelope', 'maxNativeWork'], 'policy.nativeWork');
  exactKeys(value.nativeWork.corpus, ['count', 'sha256'], 'policy.nativeWork.corpus');
  exactKeys(value.nativeWork.maximumEnvelope, ['id', 'sha256', 'work'], 'policy.nativeWork.maximumEnvelope');
  if (value.nativeWork.formula !== KERN_CHECKER_NATIVE_WORK_FORMULA) fail('native-work formula is unsupported');
  positiveSafe(value.nativeWork.corpus.count, 'policy.nativeWork.corpus.count');
  digestText(value.nativeWork.corpus.sha256, 'policy.nativeWork.corpus.sha256');
  if (typeof value.nativeWork.maximumEnvelope.id !== 'string' || value.nativeWork.maximumEnvelope.id.length === 0) {
    fail('policy.nativeWork.maximumEnvelope.id must be non-empty text');
  }
  digestText(value.nativeWork.maximumEnvelope.sha256, 'policy.nativeWork.maximumEnvelope.sha256');
  positiveSafe(value.nativeWork.maximumEnvelope.work, 'policy.nativeWork.maximumEnvelope.work');
  positiveSafe(value.nativeWork.maxNativeWork, 'policy.nativeWork.maxNativeWork');
  if (value.nativeWork.maxNativeWork >= Number.MAX_SAFE_INTEGER) fail('maxNativeWork must leave a saturation sentinel');
  if (value.nativeWork.maxNativeWork !== Math.ceil((5 * value.nativeWork.maximumEnvelope.work) / 4)) {
    fail('maxNativeWork must equal the corpus maximum plus 25 percent');
  }
  exactKeys(
    value.profileLimits,
    ['maxDiagnostics', 'maxFactCells', 'maxInputBytes', 'maxPathBytes', 'maxResultBytes', 'maxRowsPerFamily'],
    'policy.profileLimits',
  );
  exactKeys(value.runtimeLimits, KERN_RUNTIME_HANDLER_LIMIT_KEYS, 'policy.runtimeLimits');
  for (const [key, limit] of Object.entries(value.profileLimits)) positiveSafe(limit, `policy.profileLimits.${key}`);
  for (const [key, limit] of Object.entries(value.runtimeLimits)) positiveSafe(limit, `policy.runtimeLimits.${key}`);
  const policy = value as unknown as KernCheckerPolicy;
  if (policy.profileLimits.maxRowsPerFamily > policy.runtimeLimits.maxCollectionLength) {
    fail('maxRowsPerFamily must fit maxCollectionLength');
  }
  if (policy.profileLimits.maxInputBytes > policy.runtimeLimits.maxBytes)
    fail('maxInputBytes must fit runtime maxBytes');
  if (policy.profileLimits.maxResultBytes > policy.runtimeLimits.maxBytes)
    fail('maxResultBytes must fit runtime maxBytes');
  if (policy.profileLimits.maxPathBytes > policy.runtimeLimits.maxStringBytes) {
    fail('maxPathBytes must fit runtime maxStringBytes');
  }
  return structuredClone(policy);
}

function anchoredFile(directory: string, name: 'checker.composed.kern' | 'composition.json' | 'policy.json'): Buffer {
  const absolute = resolve(directory, name);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${name} must be a regular file`);
  const anchor =
    name === 'checker.composed.kern'
      ? KERN_CHECKER_TRUST.source
      : name === 'composition.json'
        ? KERN_CHECKER_TRUST.composition
        : KERN_CHECKER_TRUST.policy;
  if (stat.size !== anchor.bytes) fail(`${name} byte identity changed`);
  const bytes = readFileSync(absolute);
  if (digest(bytes) !== anchor.sha256) fail(`${name} digest identity changed`);
  return bytes;
}

export function loadKernCheckerAssets(
  directory = fileURLToPath(new URL('./kern-checker/', import.meta.url)),
): KernCheckerAssets {
  const entries = readdirSync(directory).sort();
  if (
    entries.length !== KERN_CHECKER_ASSET_NAMES.length ||
    entries.some((name, index) => name !== KERN_CHECKER_ASSET_NAMES[index])
  ) {
    fail(`asset directory must contain exactly ${KERN_CHECKER_ASSET_NAMES.join(',')}`);
  }
  for (const name of entries) {
    const stat = lstatSync(resolve(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`${name} must be a regular file`);
  }

  const sourceBytes = anchoredFile(directory, 'checker.composed.kern');
  const compositionBytes = anchoredFile(directory, 'composition.json');
  const policyBytes = anchoredFile(directory, 'policy.json');
  const manifestBytes = readFileSync(resolve(directory, 'assets.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as unknown;
  exactKeys(manifest, ['composite', 'composition', 'format', 'policy'], 'asset manifest');
  if (manifest.format !== KERN_CHECKER_ASSET_FORMAT) fail('asset manifest format is unsupported');
  const expected = {
    composite: KERN_CHECKER_TRUST.source,
    composition: KERN_CHECKER_TRUST.composition,
    policy: KERN_CHECKER_TRUST.policy,
  };
  for (const key of ['composite', 'composition', 'policy'] as const) {
    const item = manifest[key];
    exactKeys(item, ['bytes', 'sha256'], `asset manifest ${key}`);
    if (item.bytes !== expected[key].bytes || item.sha256 !== expected[key].sha256) {
      fail(`asset manifest ${key} identity changed`);
    }
  }

  const composition = JSON.parse(compositionBytes.toString('utf8')) as unknown;
  exactKeys(composition, ['composite', 'format', 'members', 'recipe'], 'composition');
  exactKeys(composition.composite, ['bytes', 'path', 'sha256'], 'composition composite');
  if (
    composition.composite.bytes !== KERN_CHECKER_TRUST.source.bytes ||
    composition.composite.sha256 !== KERN_CHECKER_TRUST.source.sha256
  ) {
    fail('composition does not bind the compiled source identity');
  }
  const policy = validatePolicy(JSON.parse(policyBytes.toString('utf8')) as unknown);
  const source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
  return { checker: { ...KERN_CHECKER_TRUST.source }, policy, source };
}
