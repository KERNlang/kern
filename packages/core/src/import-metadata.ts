// Facade. Source of truth: packages/core/src/kern/utils/import-metadata.kern.
import type { IRNode } from './types.js';
import {
  importRegistryOf,
  importTargetFamilyOf,
  importTargetOf,
  shouldEmitImportForTarget,
  splitCapabilityList,
  validateCapabilityMetadata as validateGeneratedCapabilityMetadata,
  validateImportMetadata as validateGeneratedImportMetadata,
} from './generated/utils/import-metadata.js';

export type {
  CapabilityEffect,
  CapabilityRuntime,
  CapabilitySerialization,
  ExternalImportRegistry,
  ExternalImportTarget,
} from './generated/utils/import-metadata.js';

export {
  importRegistryOf,
  importTargetFamilyOf,
  importTargetOf,
  shouldEmitImportForTarget,
  splitCapabilityList,
};

export function validateImportMetadata(node: IRNode): string[] {
  return validateGeneratedImportMetadata(node);
}

export function validateCapabilityMetadata(node: IRNode): string[] {
  return validateGeneratedCapabilityMetadata(node);
}
