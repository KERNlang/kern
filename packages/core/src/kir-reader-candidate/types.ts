/**
 * Internal reader candidate for the R1 semantic-KIR probe.
 *
 * This is deliberately not exported from any @kernlang/core package surface.
 * The format remains a probe contract until semantic ownership is proven.
 */
export const KIR_READER_CANDIDATE_FORMAT = 'kern.semantic-kir.probe.1' as const;

export const KIR_READER_CANDIDATE_NODE_KINDS = [
  'fn',
  'param',
  'handler',
  'return',
  'let',
  'capability',
  'print',
] as const;

export type KirCandidateNodeKind = (typeof KIR_READER_CANDIDATE_NODE_KINDS)[number];

export interface KirCandidatePoint {
  readonly line: number;
  readonly column: number;
}

export interface KirCandidateLocation {
  readonly start: KirCandidatePoint;
  readonly end: KirCandidatePoint | null;
}

export interface KirCandidateEntry<T> {
  readonly key: string;
  readonly value: T;
}

export type KirCandidateExpressionKind =
  | 'identifier'
  | 'integer'
  | 'negative-zero'
  | 'decimal'
  | 'text'
  | 'boolean'
  | 'null'
  | 'regex'
  | 'list'
  | 'record'
  | 'member'
  | 'index'
  | 'call'
  | 'lambda'
  | 'binary'
  | 'unary'
  | 'conditional';

export interface KirCandidateExpression {
  readonly kind: KirCandidateExpressionKind;
  readonly fields: readonly KirCandidateEntry<KirCandidateValue>[];
}

export type KirCandidateValue =
  | { readonly tag: 'null' }
  | { readonly tag: 'bool'; readonly value: boolean }
  | { readonly tag: 'text'; readonly value: string }
  | { readonly tag: 'int'; readonly value: string }
  | { readonly tag: 'negative-zero' }
  | { readonly tag: 'decimal'; readonly value: string }
  | { readonly tag: 'regex'; readonly value: { readonly pattern: string; readonly flags: string } }
  | { readonly tag: 'list'; readonly value: readonly KirCandidateValue[] }
  | { readonly tag: 'record'; readonly value: readonly KirCandidateEntry<KirCandidateValue>[] }
  | { readonly tag: 'expression'; readonly value: KirCandidateExpression };

export interface KirCandidateNode {
  readonly kind: KirCandidateNodeKind;
  readonly location: KirCandidateLocation;
  readonly properties: readonly KirCandidateEntry<KirCandidateValue>[];
  readonly children: readonly KirCandidateNode[];
}

export interface KirCandidateBinding {
  readonly imported: string;
  readonly local: string;
  readonly kind: 'fn';
  readonly reexport: boolean;
}

export interface KirCandidateImport {
  readonly source: string;
  readonly bindings: readonly KirCandidateBinding[];
}

export interface KirCandidateExport {
  readonly name: string;
  readonly kind: 'fn';
  readonly source: string | null;
}

export interface KirCandidateModule {
  readonly id: string;
  readonly imports: readonly KirCandidateImport[];
  readonly exports: readonly KirCandidateExport[];
  readonly nodes: readonly KirCandidateNode[];
}

export interface KirCandidateDiagnostic {
  readonly module: string;
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly category: string;
  readonly message: string;
  readonly location: KirCandidateLocation;
}

export interface KirCandidateEnvelope {
  readonly format: typeof KIR_READER_CANDIDATE_FORMAT;
  readonly modules: readonly KirCandidateModule[];
  readonly diagnostics: readonly KirCandidateDiagnostic[];
}
