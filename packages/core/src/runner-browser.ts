/**
 * Browser-facing runner ABI.
 *
 * This subpath intentionally exposes only source execution, capability
 * preflight, and browser-safe capability helpers. Direct IR runner internals
 * stay on `@kernlang/core/runner`.
 */

export type { RagInlineCitationChunk, RagInlineCitationGroundingOptions } from './rag-answer-citations.js';
export { inferRagAnswerGroundingSpansFromInlineCitations } from './rag-answer-citations.js';
export type {
  AsyncCapabilityId,
  AsyncRuntimeCapabilityHandler,
  AsyncRuntimeCapabilityProvider,
  CapabilityAnalysis,
  CapabilityAnalysisOptions,
  CapabilityDescriptor,
  CapabilityId,
  CapabilityInputShape,
  CapabilityRequirement,
  CapabilityStatus,
  CapabilitySyncBoundary,
  ExecuteKernSourceAsyncOptions,
  ExecuteKernSourceOptions,
  InvokeRunnerCapabilityAsyncOptions,
  KernRunnerAsyncCapabilities,
  KernRunnerCapabilities,
  KernRunnerCapabilityContext,
  KernRunnerCapabilityNamespace,
  MalformedCapabilityRequirement,
  MemoryStorageCapabilityOptions,
  RuntimeCapabilityCall,
  RuntimeCapabilityHandler,
  RuntimeCapabilityProvider,
  RuntimeCapabilityScalar,
  RuntimeCapabilityValue,
  UnknownCapabilityRequirement,
  WebCryptoCapabilityOptions,
  WebCryptoCapabilitySource,
} from './runner.js';
export {
  analyzeKernSourceCapabilities,
  assertRuntimeCapabilityValue,
  CAPABILITY_DESCRIPTORS,
  createMemoryStorageCapability,
  createWebCryptoCapability,
  DEFAULT_ASYNC_CAPABILITY_TIMEOUT_MS,
  executeKernSource,
  executeKernSourceAsync,
  invokeRunnerCapability,
  invokeRunnerCapabilityAsync,
  isRuntimeCapabilityValue,
  KernCapabilityError,
  KernRunnerError,
} from './runner.js';
