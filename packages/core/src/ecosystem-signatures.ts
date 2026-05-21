// Facade. Source of truth: packages/core/src/kern/utils/ecosystem-signatures.kern.

import * as generated from './generated/utils/ecosystem-signatures.js';
import type { ExternalImportRegistry } from './import-metadata.js';

export type { ExternalSignatureMap } from './generated/utils/ecosystem-signatures.js';

export const parseExternalSignatureMap = generated.parseExternalSignatureMap;
export const mergeExternalSignatureMaps = generated.mergeExternalSignatureMaps;

export function inferExternalSignature(
  registry: ExternalImportRegistry,
  packageName: string,
  importedName: string,
): string | undefined {
  return generated.inferExternalSignature(registry, packageName, importedName);
}

export function inferExternalSignatureMap(
  registry: ExternalImportRegistry,
  packageName: string,
): generated.ExternalSignatureMap | undefined {
  return generated.inferExternalSignatureMap(registry, packageName);
}
