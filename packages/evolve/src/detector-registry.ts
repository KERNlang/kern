/**
 * Detector Registry — pluggable detector packs for library pattern detection.
 *
 * Built-in packs ship in detectors/ directory.
 * Users can register custom detectors via kern.config.ts.
 */

import type { DetectorPack } from './types.js';

const _registry = new Map<string, DetectorPack>();

export function registerDetector(pack: DetectorPack): void {
  _registry.set(pack.id, pack);
}

export function unregisterDetector(id: string): void {
  _registry.delete(id);
}

export function getDetector(id: string): DetectorPack | undefined {
  return _registry.get(id);
}

export function getAllDetectors(): DetectorPack[] {
  return Array.from(_registry.values());
}

/**
 * Find detectors that match a given import path.
 * Checks if the import matches any of the detector's packageNames.
 */
export function getDetectorsForImport(importPath: string): DetectorPack[] {
  const results: DetectorPack[] = [];
  for (const pack of _registry.values()) {
    for (const pkgName of pack.packageNames) {
      if (importPath === pkgName || importPath.startsWith(pkgName + '/')) {
        results.push(pack);
        break;
      }
    }
  }
  return results;
}

export function clearDetectors(): void {
  _registry.clear();
}

export function detectorCount(): number {
  return _registry.size;
}

/**
 * Load all built-in detector packs.
 */
export async function loadBuiltinDetectors(): Promise<void> {
  const modules = await Promise.all([
    import('../detectors/react-forms.js'),
    import('../detectors/state-mgmt.js'),
    import('../detectors/animation.js'),
    import('../detectors/data-fetching.js'),
    import('../detectors/schema-validation.js'),
    import('../detectors/express-middleware.js'),
    import('../detectors/vue-composables.js'),
    import('../detectors/testing.js'),
  ]);
  for (const mod of modules) {
    for (const pack of mod.detectors) {
      registerDetector(pack);
    }
  }
}

/**
 * Synchronously register detector packs (for when they're already imported).
 */
export function registerDetectors(packs: DetectorPack[]): void {
  for (const pack of packs) {
    registerDetector(pack);
  }
}
