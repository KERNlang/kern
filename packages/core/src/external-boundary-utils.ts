// Facade. Source of truth: packages/core/src/kern/utils/external-boundary-utils.kern.
export type {
  ExternalBoundaryInheritance,
  ExternalBoundaryRuntimeShape,
  ExternalRuntimeImportShape,
  ExternalSidecarBoundaryShape,
  ExternalSidecarIslandShape,
  ExternalSidecarManifestShape,
  ExternalSidecarPackageShape,
  ExternalBoundaryStringKey,
} from './generated/utils/external-boundary-utils.js';

export {
  externalBoolProp,
  externalRuntimeImports,
  externalLooseSidecarManifestFromBoundary,
  externalSidecarManifestFromIsland,
  externalSidecarPackageFromBoundary,
  externalSidecarPackageKey,
  externalStringProp,
  hasExternalRuntimeImports,
  inheritExternalArgs,
  inheritExternalString,
  isLoosePythonBoundaryShape,
  isPythonSidecarBoundaryShape,
  mergeExternalSidecarManifestPackage,
  mergeExternalEffects,
  splitExternalNames,
} from './generated/utils/external-boundary-utils.js';
