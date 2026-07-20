export const CANONICAL_VALUE_FORMAT = 'kern.canonical-value.r1.5b.1' as const;

export interface CanonicalValueLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringBytes: number;
  readonly maxCollectionLength: number;
  readonly maxRecordFields: number;
  readonly maxMapEntries: number;
  readonly maxIntegerDigits: number;
  readonly maxFractionDigits: number;
  readonly maxDecimalChars: number;
}

export type CanonicalScalarValue =
  | { readonly tag: 'null' }
  | { readonly tag: 'bool'; readonly value: boolean }
  | { readonly tag: 'text'; readonly value: string }
  | { readonly tag: 'int'; readonly value: string }
  | { readonly tag: 'decimal'; readonly value: string };

export interface CanonicalRecordEntry {
  readonly key: string;
  readonly value: CanonicalValue;
}

export interface CanonicalMapEntry {
  readonly key: CanonicalScalarValue;
  readonly value: CanonicalValue;
}

export type CanonicalValue =
  | CanonicalScalarValue
  | { readonly tag: 'list'; readonly value: readonly CanonicalValue[] }
  | { readonly tag: 'record'; readonly value: readonly CanonicalRecordEntry[] }
  | { readonly tag: 'map'; readonly value: readonly CanonicalMapEntry[] }
  | {
      readonly tag: 'error';
      readonly value: {
        readonly code: string;
        readonly message: string;
        readonly details: CanonicalValue | null;
      };
    };

export interface CanonicalValueEnvelope {
  readonly format: typeof CANONICAL_VALUE_FORMAT;
  readonly value: CanonicalValue;
}

export type CanonicalValueErrorCode =
  | 'invalid-input'
  | 'invalid-limits'
  | 'limit-bytes'
  | 'limit-depth'
  | 'limit-nodes'
  | 'limit-string'
  | 'limit-collection'
  | 'limit-record'
  | 'limit-map'
  | 'limit-integer'
  | 'limit-decimal'
  | 'invalid-utf8'
  | 'invalid-json'
  | 'noncanonical'
  | 'unsupported-version'
  | 'invalid-shape'
  | 'invalid-value'
  | 'duplicate-key'
  | 'invalid-order';

export class CanonicalValueDecodeError extends TypeError {
  readonly code: CanonicalValueErrorCode;
  readonly offset: number | null;
  readonly path: string;

  constructor(code: CanonicalValueErrorCode, path: string, message: string, offset: number | null = null) {
    super(`${path}: ${message}`);
    this.name = 'CanonicalValueDecodeError';
    this.code = code;
    this.offset = offset;
    this.path = path;
  }
}
