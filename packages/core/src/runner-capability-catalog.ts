/**
 * Data-only capability catalog shared by planners and runtime lanes.
 *
 * Keep this module free of parser, runner, registration, and semantic
 * evaluator imports so low-level runtimes can classify a capability without
 * instantiating the source-analysis graph.
 */

/**
 * `shipped`: sync-executable today without any CLI opt-in flag.
 * `shipped-async`: promoted out of `--async-preview` and executed whenever an
 * async provider is supplied. `planned`: still gated behind async preview.
 */
export type CapabilityStatus = 'shipped' | 'shipped-async' | 'planned';
export type CapabilitySyncBoundary = 'sync' | 'async-planned';
export type CapabilityInputShape = 'portable-literal' | 'host-bound';

export type CapabilityId =
  | 'app-auth.verifyCredential'
  | 'app-http.header'
  | 'app-http.queryParam'
  | 'crypto.hmacVerify'
  | 'crypto.randomBytes'
  | 'crypto.randomHex'
  | 'crypto.randomUUID'
  | 'fs.list'
  | 'fs.readText'
  | 'fs.writeText'
  | 'llm.complete'
  | 'net.fetch'
  | 'rag.answer'
  | 'rag.checkAnswer'
  | 'rag.ingest'
  | 'rag.promptContext'
  | 'rag.retrieve'
  | 'rag.retrieveAsync'
  | 'storage.clear'
  | 'storage.delete'
  | 'storage.get'
  | 'storage.has'
  | 'storage.keys'
  | 'storage.set';

export const ASYNC_CAPABILITY_IDS = Object.freeze([
  'fs.list',
  'fs.readText',
  'fs.writeText',
  'llm.complete',
  'net.fetch',
  'rag.answer',
  'rag.ingest',
  'rag.retrieveAsync',
] as const satisfies readonly CapabilityId[]);

export type AsyncCapabilityId = (typeof ASYNC_CAPABILITY_IDS)[number];

export interface CapabilityDescriptor {
  readonly id: CapabilityId;
  readonly namespace: string;
  readonly operation: string;
  readonly status: CapabilityStatus;
  readonly syncBoundary: CapabilitySyncBoundary;
  readonly inputShape: CapabilityInputShape;
  readonly notes?: string;
}

function capabilityDescriptor(
  id: CapabilityId,
  status: CapabilityStatus,
  syncBoundary: CapabilitySyncBoundary,
  inputShape: CapabilityInputShape,
): CapabilityDescriptor {
  const parts = id.split('.');
  if (parts.length !== 2) throw new Error(`bad id ${id}`);
  const [namespace, operation] = parts;
  return Object.freeze({ id, namespace, operation, status, syncBoundary, inputShape });
}

export const CAPABILITY_DESCRIPTORS = Object.freeze({
  'app-auth.verifyCredential': capabilityDescriptor('app-auth.verifyCredential', 'shipped', 'sync', 'host-bound'),
  'app-http.header': capabilityDescriptor('app-http.header', 'shipped', 'sync', 'host-bound'),
  'app-http.queryParam': capabilityDescriptor('app-http.queryParam', 'shipped', 'sync', 'host-bound'),
  'crypto.hmacVerify': capabilityDescriptor('crypto.hmacVerify', 'shipped', 'sync', 'host-bound'),
  'crypto.randomBytes': capabilityDescriptor('crypto.randomBytes', 'shipped', 'sync', 'portable-literal'),
  'crypto.randomHex': capabilityDescriptor('crypto.randomHex', 'shipped', 'sync', 'portable-literal'),
  'crypto.randomUUID': capabilityDescriptor('crypto.randomUUID', 'shipped', 'sync', 'portable-literal'),
  'fs.list': capabilityDescriptor('fs.list', 'planned', 'async-planned', 'host-bound'),
  'fs.readText': capabilityDescriptor('fs.readText', 'planned', 'async-planned', 'host-bound'),
  'fs.writeText': capabilityDescriptor('fs.writeText', 'planned', 'async-planned', 'host-bound'),
  'llm.complete': capabilityDescriptor('llm.complete', 'shipped-async', 'async-planned', 'portable-literal'),
  'net.fetch': capabilityDescriptor('net.fetch', 'planned', 'async-planned', 'portable-literal'),
  'rag.answer': capabilityDescriptor('rag.answer', 'shipped-async', 'async-planned', 'portable-literal'),
  'rag.checkAnswer': capabilityDescriptor('rag.checkAnswer', 'shipped', 'sync', 'portable-literal'),
  'rag.ingest': capabilityDescriptor('rag.ingest', 'shipped-async', 'async-planned', 'host-bound'),
  'rag.promptContext': capabilityDescriptor('rag.promptContext', 'shipped', 'sync', 'portable-literal'),
  'rag.retrieve': capabilityDescriptor('rag.retrieve', 'shipped', 'sync', 'portable-literal'),
  'rag.retrieveAsync': capabilityDescriptor('rag.retrieveAsync', 'shipped-async', 'async-planned', 'host-bound'),
  'storage.clear': capabilityDescriptor('storage.clear', 'shipped', 'sync', 'host-bound'),
  'storage.delete': capabilityDescriptor('storage.delete', 'shipped', 'sync', 'host-bound'),
  'storage.get': capabilityDescriptor('storage.get', 'shipped', 'sync', 'host-bound'),
  'storage.has': capabilityDescriptor('storage.has', 'shipped', 'sync', 'host-bound'),
  'storage.keys': capabilityDescriptor('storage.keys', 'shipped', 'sync', 'host-bound'),
  'storage.set': capabilityDescriptor('storage.set', 'shipped', 'sync', 'host-bound'),
} satisfies Record<CapabilityId, CapabilityDescriptor>);
