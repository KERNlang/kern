// Facade. Source of truth: packages/core/src/kern/utils/external-boundary-utils.kern.
export type {
  ExternalBoundaryInheritance,
  ExternalBoundaryRuntimeShape,
  ExternalBoundaryStringKey,
} from './generated/utils/external-boundary-utils.js';

export {
  externalBoolProp,
  externalStringProp,
  hasExternalRuntimeImports,
  inheritExternalArgs,
  inheritExternalString,
  isLoosePythonBoundaryShape,
  isPythonSidecarBoundaryShape,
  mergeExternalEffects,
  splitExternalNames,
} from './generated/utils/external-boundary-utils.js';
