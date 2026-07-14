/** Public runtime surface. State ownership stays separate from app/runner adapters. */

export type {
  KernAppDescriptor,
  KernAppDescriptorSourceLoaderContext,
  KernAppEntryDescriptor,
  KernAppExecutablePolicyKind,
  KernAppPolicyExecution,
  KernAppPolicySlot,
  KernAppPolicySlotDescriptor,
  KernAppRouteDescriptor,
  KernAppViewDescriptor,
  LoadKernAppDescriptorOptions,
} from './app-descriptor.js';
export {
  executeKernAppEntryPolicySlot,
  findMissingKernAppEntryCapability,
  KERN_APP_POLICY_EXECUTABLE_KINDS,
  KernAppDescriptorError,
  loadKernAppDescriptor,
  normalizeKernHmacAlgorithm,
} from './app-descriptor.js';
export type { ParserHintsConfig } from './runtime-state.js';
export { defaultRuntime, KernRuntime } from './runtime-state.js';
