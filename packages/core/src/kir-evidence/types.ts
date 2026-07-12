import type { CanonicalValueLimits } from '../canonical-value/types.js';

export const KIR_EVIDENCE_FORMAT = 'kern.kir.evidence.r1.5d.1-alpha' as const;

export type KirEvidenceSeverity = 'error' | 'warning' | 'info';
export type KirEvidenceCategory = 'source' | 'parser' | 'validator' | 'codegen' | 'migration';

export interface KirEvidenceSourceInput {
  readonly moduleId: string;
  readonly source: string;
}

export interface KirEvidenceSpanInput {
  readonly content: string;
  readonly id: string;
  readonly moduleId: string;
  readonly nodePath: readonly number[];
  readonly propertyKey: string | null;
  readonly startByte: number;
  readonly endByte: number;
}

export interface KirEvidenceDiagnosticInput {
  readonly id: string;
  readonly code: string;
  readonly severity: KirEvidenceSeverity;
  readonly category: KirEvidenceCategory;
  readonly moduleId: string;
  readonly spanId: string;
  readonly message: string;
}

export interface KirEvidenceInput {
  readonly semanticBytes: Uint8Array;
  readonly sources: readonly KirEvidenceSourceInput[];
  readonly spans: readonly KirEvidenceSpanInput[];
  readonly diagnostics: readonly KirEvidenceDiagnosticInput[];
}

export interface KirEvidenceSource {
  readonly moduleId: string;
  readonly sha256: string;
  readonly utf8ByteLength: number;
}

export interface KirEvidenceSpan extends KirEvidenceSpanInput {
  readonly contentSha256: string;
}

export interface KirEvidenceDiagnostic extends KirEvidenceDiagnosticInput {
  readonly messageSha256: string;
}

export interface KirEvidenceArtifact {
  readonly diagnostics: readonly KirEvidenceDiagnostic[];
  readonly format: typeof KIR_EVIDENCE_FORMAT;
  readonly proofLabel: 'ALPHA-NO-GO';
  readonly semantic: {
    readonly format: string;
    readonly sha256: string;
  };
  readonly sources: readonly KirEvidenceSource[];
  readonly spans: readonly KirEvidenceSpan[];
}

export type KirEvidenceErrorCode =
  | 'invalid-evidence-artifact'
  | 'unsupported-evidence-version'
  | 'semantic-digest-mismatch'
  | 'source-binding-mismatch'
  | 'invalid-span'
  | 'dangling-span'
  | 'invalid-diagnostic';

export class KirEvidenceError extends TypeError {
  readonly code: KirEvidenceErrorCode;
  readonly path: string;

  constructor(code: KirEvidenceErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'KirEvidenceError';
    this.code = code;
    this.path = path;
  }
}

export interface KirEvidenceCodecOptions {
  readonly limits: CanonicalValueLimits;
}
