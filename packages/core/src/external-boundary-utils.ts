// Facade. Source of truth: packages/core/src/kern/utils/external-boundary-utils.kern.
export type {
  ExternalBoundaryInheritance,
  ExternalBoundaryRuntimeShape,
  ExternalRuntimeImportShape,
  ExternalSidecarBoundaryShape,
  ExternalSidecarPackageShape,
  ExternalBoundaryStringKey,
} from './generated/utils/external-boundary-utils.js';

export {
  externalBoolProp,
  externalRuntimeImports,
  externalSidecarPackageFromBoundary,
  externalSidecarPackageKey,
  externalStringProp,
  hasExternalRuntimeImports,
  inheritExternalArgs,
  inheritExternalString,
  isLoosePythonBoundaryShape,
  isPythonSidecarBoundaryShape,
  mergeExternalEffects,
  splitExternalNames,
} from './generated/utils/external-boundary-utils.js';
