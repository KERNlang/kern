import type { RagVectorStoreAdapterContract, RagVectorStoreConformanceReport } from './rag-adapter-conformance.js';

/**
 * Host-registered external vector-store adapter registry (KERN 5.2).
 *
 * The runtime ragRetrieve runner ships two built-in store kinds (`memory`,
 * `local-persistent`). A host may additionally register an EXTERNAL adapter
 * kind — but only through `registerExternalRagVectorStoreAdapter` in
 * rag-retrieve-runner.ts, which RUNS the vector-store conformance suite
 * (rag-adapter-conformance.ts) against the supplied contract and fails closed
 * unless every case passes. This module is intentionally a leaf (type-only
 * imports) so the semantic validator can consult the registry without
 * creating an import cycle through the conformance harness.
 *
 * Deny-by-default: a `.kern` vectorStore kind that is neither built-in nor
 * registered here fails semantic validation and runtime preparation.
 */
export interface RegisteredExternalRagVectorStoreAdapter {
  readonly kind: string;
  readonly contract: RagVectorStoreAdapterContract;
  readonly conformance: RagVectorStoreConformanceReport;
}

export const BUILTIN_RUNTIME_RAG_VECTOR_STORE_KINDS = Object.freeze(['memory', 'local-persistent'] as const);

const REGISTRY = new Map<string, RegisteredExternalRagVectorStoreAdapter>();

export function isRegisteredExternalRagVectorStoreKind(kind: string): boolean {
  return REGISTRY.has(kind);
}

export function registeredExternalRagVectorStoreAdapter(
  kind: string,
): RegisteredExternalRagVectorStoreAdapter | undefined {
  return REGISTRY.get(kind);
}

export function registeredExternalRagVectorStoreKinds(): readonly string[] {
  return [...REGISTRY.keys()];
}

/** Removes a registered external adapter kind. Returns true when it existed. */
export function unregisterExternalRagVectorStoreAdapter(kind: string): boolean {
  return REGISTRY.delete(kind);
}

/**
 * Internal registration primitive. Do NOT call directly — the supported,
 * fail-closed entry point is `registerExternalRagVectorStoreAdapter`
 * (rag-retrieve-runner.ts), which runs the conformance suite first. This
 * function is exported only so that module can write to the registry without
 * an import cycle; it is intentionally NOT re-exported from the package
 * barrel.
 */
export function unsafeSetRegisteredExternalRagVectorStoreAdapter(
  record: RegisteredExternalRagVectorStoreAdapter,
): void {
  REGISTRY.set(record.kind, record);
}
