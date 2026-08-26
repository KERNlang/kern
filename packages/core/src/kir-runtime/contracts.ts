export const KERN_KIR_RUNTIME_OWNER = 'kern.runtime.kir.owner.v1' as const;
export const KERN_KIR_RUNTIME_FORMAT = 'kern.runtime.kir.v1' as const;

export type KernKirValue =
  | { readonly tag: 'null' }
  | { readonly tag: 'boolean'; readonly value: boolean }
  | { readonly tag: 'text'; readonly value: string }
  | { readonly tag: 'integer'; readonly value: string }
  | { readonly tag: 'decimal'; readonly value: string }
  | { readonly tag: 'list'; readonly value: readonly KernKirValue[] }
  | {
      readonly tag: 'record';
      readonly value: readonly { readonly key: string; readonly value: KernKirValue }[];
    };

export type KernKirSlot =
  | { readonly presence: 'absent' }
  | { readonly presence: 'value'; readonly value: KernKirValue };

export interface KernKirLimits {
  readonly maxBytes: number;
  readonly maxCollectionLength: number;
  readonly maxDepth: number;
  readonly maxDiagnostics: number;
  readonly maxEvents: number;
  readonly maxSteps: number;
  readonly maxStringBytes: number;
}

export interface KernKirRequest {
  readonly format: typeof KERN_KIR_RUNTIME_FORMAT;
  readonly requestId: string;
  readonly entry: {
    readonly moduleId: string;
    readonly handlerName: string;
  };
  readonly arguments: Readonly<Record<string, KernKirValue>>;
  readonly control: {
    readonly preCancelled: boolean;
    readonly timeoutMs: number | null;
  };
  readonly limits: KernKirLimits;
}

export interface KernKirCapabilityCall {
  readonly namespace: string;
  readonly operation: string;
  readonly input: KernKirSlot;
  readonly signal: AbortSignal;
}

export interface KernKirExecutionOptions {
  readonly invoke?: (call: KernKirCapabilityCall) => PromiseLike<KernKirSlot> | KernKirSlot;
  readonly signal?: AbortSignal;
}

export type KernKirEvent =
  | { readonly op: 'stdout'; readonly text: string }
  | {
      readonly input: KernKirSlot;
      readonly namespace: string;
      readonly op: 'capability';
      readonly operation: string;
      readonly result: KernKirSlot;
    };

export type KernKirDiagnosticCode =
  | 'capability-error'
  | 'execution-cancelled'
  | 'execution-timeout'
  | 'handler-entry-ambiguous'
  | 'handler-entry-not-found'
  | 'handler-entry-unsupported'
  | 'handler-link-error'
  | 'invalid-handler-arguments'
  | 'invalid-handler-result'
  | 'projection-authentication-error'
  | 'runtime-limit-exceeded'
  | 'unsupported-runtime-input';

export interface KernKirDiagnostic {
  readonly category: 'runtime';
  readonly code: KernKirDiagnosticCode;
  readonly phase: 'execution' | 'link';
}

export interface KernKirEnvelope {
  readonly completion: { readonly kind: 'return' | 'error' };
  readonly diagnostics: readonly KernKirDiagnostic[];
  readonly events: readonly KernKirEvent[];
  readonly format: typeof KERN_KIR_RUNTIME_FORMAT;
  readonly outcome: 'success' | 'failure';
  readonly requestId: string | null;
  readonly result: KernKirSlot;
}

export class KernKirFault extends Error {
  readonly code: KernKirDiagnosticCode;
  readonly phase: KernKirDiagnostic['phase'];

  constructor(code: KernKirDiagnosticCode, phase: KernKirDiagnostic['phase'], message: string) {
    super(message);
    this.name = 'KernKirFault';
    this.code = code;
    this.phase = phase;
  }
}
