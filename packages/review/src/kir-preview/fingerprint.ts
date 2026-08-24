import { canonicalJson, sha256 } from './canonical.js';
import type { CanonicalKirFinding } from './types.js';

export function findingFingerprint(finding: Omit<CanonicalKirFinding, 'fingerprint'>): string {
  return `kir-preview:${sha256(canonicalJson(finding))}`;
}
