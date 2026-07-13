import type { InternalRuntimeCapabilityInterceptor } from '../ir/semantics/internal-capability-interceptor.js';

export const INTERNAL_RUNTIME_ENVELOPE_FORMAT = 'kern.runtime.internal.r0' as const;

export interface InternalRuntimeEnvelopeLimits {
  readonly maxBytes: number;
  readonly maxCollectionLength: number;
  readonly maxDepth: number;
  readonly maxDiagnostics: number;
  readonly maxEvents: number;
  readonly maxStringBytes: number;
}

export type InternalRuntimeValue =
  | { readonly tag: 'null' }
  | { readonly tag: 'boolean'; readonly value: boolean }
  | { readonly tag: 'text'; readonly value: string }
  | { readonly tag: 'integer'; readonly value: string }
  | { readonly tag: 'decimal'; readonly value: string }
  | { readonly tag: 'list'; readonly value: readonly InternalRuntimeValue[] }
  | {
      readonly tag: 'record';
      readonly value: readonly { readonly key: string; readonly value: InternalRuntimeValue }[];
    };

export type InternalRuntimeSlot =
  | { readonly presence: 'absent' }
  | { readonly presence: 'value'; readonly value: InternalRuntimeValue };

export type InternalRuntimeEvent =
  | { readonly op: 'stdout'; readonly text: string }
  | { readonly op: 'stderr'; readonly text: string }
  | {
      readonly input: InternalRuntimeSlot;
      readonly namespace: string;
      readonly op: 'capability';
      readonly operation: string;
      readonly result: InternalRuntimeSlot;
    };

export type InternalRuntimeDiagnosticCode =
  | 'capability-error'
  | 'encoded-limit'
  | 'escaped-control'
  | 'execution-cancelled'
  | 'execution-timeout'
  | 'handler-entry-ambiguous'
  | 'handler-entry-not-found'
  | 'handler-entry-unsupported'
  | 'handler-link-error'
  | 'invalid-handler-arguments'
  | 'internal-runner-error'
  | 'non-portable-value'
  | 'uncaught-throw'
  | 'unsupported-runtime-input';

export interface InternalRuntimeDiagnostic {
  readonly category: 'runtime';
  readonly code: InternalRuntimeDiagnosticCode;
  readonly phase: 'execution' | 'link';
}

export interface InternalRuntimeEnvelope {
  readonly completion: { readonly kind: 'normal' | 'return' | 'error' };
  readonly diagnostics: readonly InternalRuntimeDiagnostic[];
  readonly events: readonly InternalRuntimeEvent[];
  readonly format: typeof INTERNAL_RUNTIME_ENVELOPE_FORMAT;
  readonly outcome: 'success' | 'failure';
  readonly result: InternalRuntimeSlot;
}

export interface InternalRuntimeEnvelopeOptions {
  readonly capabilityInterceptor?: InternalRuntimeCapabilityInterceptor;
  readonly enabled: true;
  readonly limits: InternalRuntimeEnvelopeLimits;
  readonly scheduler?: {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  };
}

export class InternalRuntimeEnvelopeError extends TypeError {
  readonly code: 'disabled' | 'invalid-limits' | 'invalid-value' | 'limit-exceeded';

  constructor(code: InternalRuntimeEnvelopeError['code'], message: string) {
    super(message);
    this.name = 'InternalRuntimeEnvelopeError';
    this.code = code;
  }
}
