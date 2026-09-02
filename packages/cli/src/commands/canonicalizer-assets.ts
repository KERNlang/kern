import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { KernRuntimeHandlerLimits } from '@kernlang/core/runtime/handler';

interface CanonicalValueLimits {
  readonly maxBytes: number;
  readonly maxCollectionLength: number;
  readonly maxDecimalChars: number;
  readonly maxDepth: number;
  readonly maxFractionDigits: number;
  readonly maxIntegerDigits: number;
  readonly maxMapEntries: number;
  readonly maxNodes: number;
  readonly maxRecordFields: number;
  readonly maxStringBytes: number;
}

interface CanonicalizerPolicy {
  readonly expansionLimits: {
    readonly kirToSourceMaxFactor: number;
    readonly runtimeEnvelopeMaxFactor: number;
  };
  readonly kirLimits: CanonicalValueLimits;
  readonly profileLimits: {
    readonly maxNodeRows: number;
    readonly maxPropertyRows: number;
    readonly maxValueRows: number;
  };
  readonly runtimeLimits: KernRuntimeHandlerLimits;
}

export interface CanonicalizerAssets {
  readonly bytes: number;
  readonly policy: CanonicalizerPolicy;
  readonly sha256: string;
  readonly source: string;
}

const POLICY_KEYS = {
  expansionLimits: ['kirToSourceMaxFactor', 'runtimeEnvelopeMaxFactor'],
  kirLimits: [
    'maxBytes',
    'maxCollectionLength',
    'maxDecimalChars',
    'maxDepth',
    'maxFractionDigits',
    'maxIntegerDigits',
    'maxMapEntries',
    'maxNodes',
    'maxRecordFields',
    'maxStringBytes',
  ],
  profileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
  runtimeLimits: [
    'maxBytes',
    'maxCollectionLength',
    'maxDepth',
    'maxDiagnostics',
    'maxEvents',
    'maxIterations',
    'maxStringBytes',
  ],
} as const;

function fail(message: string): never {
  throw new TypeError(`canonicalizer asset rejection: ${message}`);
}

function exactRecord(value: unknown, expected: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const fields = [...expected].sort();
  if (actual.length !== fields.length || actual.some((key, index) => key !== fields[index])) {
    fail(`${label} must contain exactly ${fields.join(',')}`);
  }
  return record;
}

function positiveIntegers(value: unknown, keys: readonly string[], label: string): Record<string, number> {
  const record = exactRecord(value, keys, label);
  for (const [key, entry] of Object.entries(record)) {
    if (!Number.isSafeInteger(entry) || (entry as number) <= 0) {
      fail(`${label}.${key} must be a positive safe integer`);
    }
  }
  return record as Record<string, number>;
}

function parsePolicy(bytes: Buffer): CanonicalizerPolicy {
  const input = exactRecord(JSON.parse(bytes.toString('utf8')), Object.keys(POLICY_KEYS), 'policy');
  const expansionLimits = positiveIntegers(input.expansionLimits, POLICY_KEYS.expansionLimits, 'expansionLimits');
  const kirLimits = positiveIntegers(input.kirLimits, POLICY_KEYS.kirLimits, 'kirLimits');
  const profileLimits = positiveIntegers(input.profileLimits, POLICY_KEYS.profileLimits, 'profileLimits');
  const runtimeLimits = positiveIntegers(input.runtimeLimits, POLICY_KEYS.runtimeLimits, 'runtimeLimits');
  const requiredStringBytes = kirLimits.maxBytes * expansionLimits.kirToSourceMaxFactor;
  const requiredEnvelopeBytes = runtimeLimits.maxStringBytes * expansionLimits.runtimeEnvelopeMaxFactor;
  if (!Number.isSafeInteger(requiredStringBytes) || runtimeLimits.maxStringBytes < requiredStringBytes) {
    fail('runtime maxStringBytes does not cover KIR-to-source expansion');
  }
  if (!Number.isSafeInteger(requiredEnvelopeBytes) || runtimeLimits.maxBytes < requiredEnvelopeBytes) {
    fail('runtime maxBytes does not cover envelope expansion');
  }
  return {
    expansionLimits: {
      kirToSourceMaxFactor: expansionLimits.kirToSourceMaxFactor,
      runtimeEnvelopeMaxFactor: expansionLimits.runtimeEnvelopeMaxFactor,
    },
    kirLimits: {
      maxBytes: kirLimits.maxBytes,
      maxCollectionLength: kirLimits.maxCollectionLength,
      maxDecimalChars: kirLimits.maxDecimalChars,
      maxDepth: kirLimits.maxDepth,
      maxFractionDigits: kirLimits.maxFractionDigits,
      maxIntegerDigits: kirLimits.maxIntegerDigits,
      maxMapEntries: kirLimits.maxMapEntries,
      maxNodes: kirLimits.maxNodes,
      maxRecordFields: kirLimits.maxRecordFields,
      maxStringBytes: kirLimits.maxStringBytes,
    },
    profileLimits: {
      maxNodeRows: profileLimits.maxNodeRows,
      maxPropertyRows: profileLimits.maxPropertyRows,
      maxValueRows: profileLimits.maxValueRows,
    },
    runtimeLimits: {
      maxBytes: runtimeLimits.maxBytes,
      maxCollectionLength: runtimeLimits.maxCollectionLength,
      maxDepth: runtimeLimits.maxDepth,
      maxDiagnostics: runtimeLimits.maxDiagnostics,
      maxEvents: runtimeLimits.maxEvents,
      maxIterations: runtimeLimits.maxIterations,
      maxStringBytes: runtimeLimits.maxStringBytes,
    },
  };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assetDigest(value: unknown, label: string): { bytes: number; sha256: string } {
  const record = exactRecord(value, ['bytes', 'sha256'], label);
  if (
    !Number.isSafeInteger(record.bytes) ||
    (record.bytes as number) <= 0 ||
    typeof record.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(record.sha256)
  ) {
    fail(`${label} metadata is invalid`);
  }
  return record as { bytes: number; sha256: string };
}

export function loadCanonicalizerAssets(): CanonicalizerAssets {
  const sourceBytes = readFileSync(new URL('../kern-canonicalizer/canonicalizer.composed.kern', import.meta.url));
  const policyBytes = readFileSync(new URL('../kern-canonicalizer/policy.json', import.meta.url));
  const manifest = exactRecord(
    JSON.parse(readFileSync(new URL('../kern-canonicalizer/assets.json', import.meta.url), 'utf8')),
    ['codec', 'composite', 'format', 'policy'],
    'asset manifest',
  );
  if (manifest.format !== 'kern.cli.canonicalizer.assets.2') fail('asset manifest format is unsupported');
  const manifestComposite = assetDigest(manifest.composite, 'asset manifest composite');
  const manifestPolicy = assetDigest(manifest.policy, 'asset manifest policy');
  if (!Array.isArray(manifest.codec) || manifest.codec.length === 0) {
    fail('asset manifest codec must be a non-empty list');
  }
  let previousPath = '';
  for (const [index, value] of manifest.codec.entries()) {
    const record = exactRecord(value, ['bytes', 'path', 'sha256'], `asset manifest codec[${index}]`);
    const digest = assetDigest({ bytes: record.bytes, sha256: record.sha256 }, `asset manifest codec[${index}]`);
    if (
      typeof record.path !== 'string' ||
      !/^core\/[a-zA-Z0-9._/-]+\.js$/u.test(record.path) ||
      record.path.includes('/../') ||
      record.path <= previousPath
    ) {
      fail(`asset manifest codec[${index}] path is invalid or unordered`);
    }
    const bytes = readFileSync(new URL(`../kern-canonicalizer/${record.path}`, import.meta.url));
    if (bytes.length !== digest.bytes || sha256(bytes) !== digest.sha256) {
      fail(`codec module ${record.path} does not match authenticated build metadata`);
    }
    previousPath = record.path;
  }
  if (policyBytes.length !== manifestPolicy.bytes || sha256(policyBytes) !== manifestPolicy.sha256) {
    fail('policy bytes do not match authenticated build metadata');
  }
  const composition = exactRecord(
    JSON.parse(readFileSync(new URL('../kern-canonicalizer/composition.json', import.meta.url), 'utf8')),
    ['composite', 'format', 'members', 'recipe'],
    'composition',
  );
  if (composition.format !== 'kern.canonicalizer.composition.1') fail('composition format is unsupported');
  const composite = exactRecord(composition.composite, ['bytes', 'path', 'sha256'], 'composition.composite');
  if (
    composite.path !== 'examples/kern-canonicalizer/canonicalizer.composed.kern' ||
    !Number.isSafeInteger(composite.bytes) ||
    (composite.bytes as number) <= 0 ||
    typeof composite.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(composite.sha256)
  ) {
    fail('composition metadata is invalid');
  }
  if (composite.bytes !== manifestComposite.bytes || composite.sha256 !== manifestComposite.sha256) {
    fail('composition does not match authenticated build metadata');
  }
  if (sourceBytes.length !== composite.bytes || sha256(sourceBytes) !== composite.sha256) {
    fail('composite bytes do not match authenticated metadata');
  }
  return {
    bytes: composite.bytes,
    policy: parsePolicy(policyBytes),
    sha256: composite.sha256,
    source: sourceBytes.toString('utf8'),
  } as CanonicalizerAssets;
}
