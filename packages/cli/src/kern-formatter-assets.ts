import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KERN_FORMATTER_ASSET_FORMAT = 'kern.cli.formatter.assets.1';
export const KERN_FORMATTER_ASSET_NAMES = Object.freeze([
  'assets.json',
  'composition.json',
  'formatter.composed.kern',
  'policy.json',
]);

export const KERN_FORMATTER_TRUST = Object.freeze({
  composition: { bytes: 836, sha256: '791574a8b526359baf8613f4964e056c510428ad4399d8b9a92099661d69be1f' },
  policy: { bytes: 462, sha256: 'dba84fae4a476ae4c5c8fc6d06a5eed9b29d376a617fcf145432b671b587a063' },
  source: { bytes: 24_203, sha256: '461487b0bc0a7f2b5e9d3db77853575e696b83351cfb2aca09dd60a00d6832b0' },
});

export interface KernFormatterPolicy {
  readonly format: 'kern.formatter.policy.1';
  readonly profileLimits: {
    readonly maxCodePoints: number;
    readonly maxInputBytes: number;
    readonly maxLexicalDepth: number;
    readonly maxRecordCodePoints: number;
    readonly maxRecords: number;
    readonly maxResultBytes: number;
    readonly maxResultCodePoints: number;
  };
  readonly runtimeLimits: {
    readonly maxBytes: number;
    readonly maxCollectionLength: number;
    readonly maxDepth: number;
    readonly maxDiagnostics: number;
    readonly maxEvents: number;,
    maxIterations: number;,
    readonly maxStringBytes: number;
  };
}

export interface KernFormatterAssets {
  readonly formatter: { readonly bytes: number; readonly sha256: string };
  readonly policy: KernFormatterPolicy;
  readonly source: string;
}

function fail(detail: string): never {
  throw new TypeError(`KERN formatter asset rejection: ${detail}`);
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

function validatePolicy(value: unknown): KernFormatterPolicy {
  exactKeys(value, ['format', 'profileLimits', 'runtimeLimits'], 'policy');
  if (value.format !== 'kern.formatter.policy.1') fail('policy format is unsupported');
  exactKeys(
    value.profileLimits,
    [
      'maxCodePoints',
      'maxInputBytes',
      'maxLexicalDepth',
      'maxRecordCodePoints',
      'maxRecords',
      'maxResultBytes',
      'maxResultCodePoints',
    ],
    'policy.profileLimits',
  );
  exactKeys(
    value.runtimeLimits,
    ['maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxStringBytes'],
    'policy.runtimeLimits',
  );
  for (const [key, limit] of Object.entries(value.profileLimits)) positiveSafe(limit, `policy.profileLimits.${key}`);
  for (const [key, limit] of Object.entries(value.runtimeLimits)) positiveSafe(limit, `policy.runtimeLimits.${key}`);
  const policy = value as unknown as KernFormatterPolicy;
  if (policy.profileLimits.maxInputBytes > policy.runtimeLimits.maxBytes) fail('maxInputBytes must fit maxBytes');
  if (policy.profileLimits.maxResultBytes > policy.runtimeLimits.maxBytes) fail('maxResultBytes must fit maxBytes');
  if (policy.profileLimits.maxLexicalDepth > policy.profileLimits.maxRecordCodePoints) {
    fail('maxLexicalDepth must fit maxRecordCodePoints');
  }
  if (policy.profileLimits.maxRecordCodePoints > policy.profileLimits.maxCodePoints) {
    fail('maxRecordCodePoints must fit maxCodePoints');
  }
  if (policy.profileLimits.maxResultCodePoints < policy.profileLimits.maxCodePoints + 2) {
    fail('maxResultCodePoints must admit a missing CRLF terminator');
  }
  if (policy.profileLimits.maxRecords > 32768) fail('maxRecords exceeds the compiled reduction network');
  if (policy.profileLimits.maxRecords * 8 + 12 > policy.runtimeLimits.maxCollectionLength) {
    fail('maxRecords must fit runtime collection length');
  }
  return structuredClone(policy);
}

function anchoredFile(directory: string, name: 'composition.json' | 'formatter.composed.kern' | 'policy.json'): Buffer {
  const absolute = resolve(directory, name);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${name} must be a regular file`);
  const anchor =
    name === 'formatter.composed.kern'
      ? KERN_FORMATTER_TRUST.source
      : name === 'composition.json'
        ? KERN_FORMATTER_TRUST.composition
        : KERN_FORMATTER_TRUST.policy;
  if (stat.size !== anchor.bytes) fail(`${name} byte identity changed`);
  const bytes = readFileSync(absolute);
  if (digest(bytes) !== anchor.sha256) fail(`${name} digest identity changed`);
  return bytes;
}

export function loadKernFormatterAssets(
  directory = fileURLToPath(new URL('./kern-formatter/', import.meta.url)),
): KernFormatterAssets {
  const entries = readdirSync(directory).sort();
  if (
    entries.length !== KERN_FORMATTER_ASSET_NAMES.length ||
    entries.some((name, index) => name !== KERN_FORMATTER_ASSET_NAMES[index])
  ) {
    fail(`asset directory must contain exactly ${KERN_FORMATTER_ASSET_NAMES.join(',')}`);
  }
  for (const name of entries) {
    const stat = lstatSync(resolve(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`${name} must be a regular file`);
  }
  const sourceBytes = anchoredFile(directory, 'formatter.composed.kern');
  const compositionBytes = anchoredFile(directory, 'composition.json');
  const policyBytes = anchoredFile(directory, 'policy.json');
  const manifest = JSON.parse(readFileSync(resolve(directory, 'assets.json'), 'utf8')) as unknown;
  exactKeys(manifest, ['composition', 'format', 'policy', 'source'], 'asset manifest');
  if (manifest.format !== KERN_FORMATTER_ASSET_FORMAT) fail('asset manifest format is unsupported');
  const expected = {
    composition: KERN_FORMATTER_TRUST.composition,
    policy: KERN_FORMATTER_TRUST.policy,
    source: KERN_FORMATTER_TRUST.source,
  };
  for (const key of ['composition', 'policy', 'source'] as const) {
    exactKeys(manifest[key], ['bytes', 'sha256'], `asset manifest ${key}`);
    if (manifest[key].bytes !== expected[key].bytes || manifest[key].sha256 !== expected[key].sha256) {
      fail(`asset manifest ${key} identity changed`);
    }
  }
  const composition = JSON.parse(compositionBytes.toString('utf8')) as unknown;
  exactKeys(composition, ['composite', 'format', 'members', 'recipe'], 'composition');
  exactKeys(composition.composite, ['bytes', 'path', 'sha256'], 'composition composite');
  if (
    composition.composite.bytes !== KERN_FORMATTER_TRUST.source.bytes ||
    composition.composite.sha256 !== KERN_FORMATTER_TRUST.source.sha256
  ) {
    fail('composition does not bind compiled source identity');
  }
  return {
    formatter: { ...KERN_FORMATTER_TRUST.source },
    policy: validatePolicy(JSON.parse(policyBytes.toString('utf8')) as unknown),
    source: new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes),
  };
}
