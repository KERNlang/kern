// Facade. Source of truth: packages/core/src/kern/utils/external-symbol-utils.kern.
import { parseExternalNamedBindingShape } from './generated/utils/external-symbol-utils.js';

export type {
  ExternalImportSymbolKindShape,
  ExternalImportSymbolShape,
  ExternalNamedBindingShape,
} from './generated/utils/external-symbol-utils.js';

export const parseExternalNamedBinding = parseExternalNamedBindingShape;

export {
  externalNamedBindingSignature,
  externalSignatureMapForSidecarPackage,
  externalSymbolsFromSidecarManifest,
  isExternalSafeIdentifier,
} from './generated/utils/external-symbol-utils.js';
