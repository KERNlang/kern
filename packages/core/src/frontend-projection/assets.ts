import { readFileSync } from 'node:fs';

import type { CanonicalValueLimits } from '../canonical-value/types.js';
import { type KernProjectionBudgetName, PROJECTION_BUDGET_KEYS } from './contracts.js';
import { deepFreeze, sha256 } from './integrity.js';

const ASSET_ROOT = new URL('../frontend-projection-assets/', import.meta.url);
const MANIFEST_URL = new URL('assets.json', ASSET_ROOT);
const HEX = /^[0-9a-f]{64}$/u;

interface AssetRecord {
  readonly bytes: number;
  readonly path: string;
  readonly sha256: string;
  readonly sourceBytes: number;
  readonly sourcePath: string;
  readonly sourceSha256: string;
}

interface ProjectionAssetManifest {
  readonly assets: readonly AssetRecord[];
  readonly canonicalLimits: CanonicalValueLimits;
  readonly compositionDigest: string;
  readonly entry: string;
  readonly f5PolicyDigest: string;
  readonly format: 'kern.frontend.packaged-projection-assets.1';
  readonly profileLimits: Readonly<Record<KernProjectionBudgetName, number>>;
}

export interface ProjectionAssetState {
  readonly canonicalLimits: CanonicalValueLimits;
  readonly compositionDigest: string;
  readonly f5PolicyDigest: string;
  readonly manifestDigest: string;
  readonly profileLimits: Readonly<Record<KernProjectionBudgetName, number>>;
}

export class ProjectionAssetError extends Error {
  constructor(message: string) {
    super(`KERN frontend projection assets: ${message}`);
    this.name = 'ProjectionAssetError';
  }
}

function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new ProjectionAssetError(`${label} shape`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ProjectionAssetError(`${label} fields`);
  }
  return record;
}

function positiveLimits(value: unknown, keys: readonly string[], label: string): Record<string, number> {
  const record = exact(value, keys, label);
  for (const key of keys) {
    if (!Number.isSafeInteger(record[key]) || (record[key] as number) < 1) {
      throw new ProjectionAssetError(`${label} ${key}`);
    }
  }
  return record as Record<string, number>;
}

function validateManifest(value: unknown): ProjectionAssetManifest {
  const manifest = exact(
    value,
    ['assets', 'canonicalLimits', 'compositionDigest', 'entry', 'f5PolicyDigest', 'format', 'profileLimits'],
    'manifest',
  );
  if (
    manifest.format !== 'kern.frontend.packaged-projection-assets.1' ||
    manifest.entry !== 'scripts/kern-frontend-f5-projection/worker.mjs' ||
    typeof manifest.compositionDigest !== 'string' ||
    !HEX.test(manifest.compositionDigest) ||
    typeof manifest.f5PolicyDigest !== 'string' ||
    !HEX.test(manifest.f5PolicyDigest) ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length === 0
  ) {
    throw new ProjectionAssetError('manifest identity');
  }
  const assets = manifest.assets.map((item, index) => {
    const asset = exact(
      item,
      ['bytes', 'path', 'sha256', 'sourceBytes', 'sourcePath', 'sourceSha256'],
      `asset ${index}`,
    );
    if (
      !Number.isSafeInteger(asset.bytes) ||
      (asset.bytes as number) < 1 ||
      !Number.isSafeInteger(asset.sourceBytes) ||
      (asset.sourceBytes as number) < 1 ||
      typeof asset.path !== 'string' ||
      asset.path === '' ||
      asset.path.startsWith('/') ||
      asset.path.includes('..') ||
      asset.sourcePath !== asset.path ||
      typeof asset.sha256 !== 'string' ||
      !HEX.test(asset.sha256) ||
      typeof asset.sourceSha256 !== 'string' ||
      !HEX.test(asset.sourceSha256)
    ) {
      throw new ProjectionAssetError(`asset ${index} identity`);
    }
    return asset as unknown as AssetRecord;
  });
  const canonicalLimits = positiveLimits(
    manifest.canonicalLimits,
    [
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
    'canonical limits',
  ) as unknown as CanonicalValueLimits;
  const profileLimits = positiveLimits(manifest.profileLimits, PROJECTION_BUDGET_KEYS, 'profile limits') as Record<
    KernProjectionBudgetName,
    number
  >;
  return {
    assets,
    canonicalLimits,
    compositionDigest: manifest.compositionDigest,
    entry: manifest.entry,
    f5PolicyDigest: manifest.f5PolicyDigest,
    format: manifest.format,
    profileLimits,
  };
}

export function loadProjectionAssetState(): ProjectionAssetState {
  try {
    const manifestBytes = readFileSync(MANIFEST_URL);
    const manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')));
    for (const asset of manifest.assets) {
      const bytes = readFileSync(new URL(asset.path, ASSET_ROOT));
      if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256) {
        throw new ProjectionAssetError(`digest ${asset.path}`);
      }
    }
    return deepFreeze({
      canonicalLimits: manifest.canonicalLimits,
      compositionDigest: manifest.compositionDigest,
      f5PolicyDigest: manifest.f5PolicyDigest,
      manifestDigest: sha256(manifestBytes),
      profileLimits: manifest.profileLimits,
    });
  } catch (error) {
    if (error instanceof ProjectionAssetError) throw error;
    throw new ProjectionAssetError(error instanceof Error ? error.message : 'unreadable closure');
  }
}
