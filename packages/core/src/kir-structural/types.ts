import type { CanonicalRecordEntry, CanonicalValue } from '../canonical-value/types.js';

export const STRUCTURAL_KIR_ARTIFACT_FORMAT = 'kern.kir.structural.r1.5c.2-alpha' as const;
export const STRUCTURAL_KIR_TYPE_CATALOG_FORMAT = 'kern.type-admission.r1.5c.2-empty' as const;

export type StructuralPropertyDisposition =
  | 'included-value'
  | 'lowered-import-path'
  | 'lowered-expression'
  | 'excluded-host-expression'
  | 'excluded-host-type'
  | 'excluded-raw-block';

export interface StructuralPropertyContract {
  readonly schemaKind: string;
  readonly required: boolean;
  readonly values: readonly string[] | null;
  readonly disposition: StructuralPropertyDisposition;
  readonly reasonId: string;
}

export interface StructuralNodeContract {
  readonly schemaStatus: 'bound' | 'missing';
  readonly allowedChildren: readonly string[] | null;
  readonly disposition: 'structural-candidate' | 'excluded-explicit';
  readonly reasonId: string;
  readonly properties: Readonly<Record<string, StructuralPropertyContract>>;
}

export interface StructuralKirNode {
  readonly kind: string;
  readonly properties: readonly CanonicalRecordEntry[];
  readonly children: readonly StructuralKirNode[];
}

export type StructuralKirErrorCode =
  | 'invalid-artifact'
  | 'unsupported-version'
  | 'unknown-node-kind'
  | 'unknown-property'
  | 'missing-property'
  | 'excluded-host-payload'
  | 'invalid-property'
  | 'invalid-child'
  | 'unknown-expression-kind'
  | 'invalid-expression'
  | 'invalid-import-path';

export class StructuralKirError extends TypeError {
  readonly code: StructuralKirErrorCode;
  readonly path: string;

  constructor(code: StructuralKirErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'StructuralKirError';
    this.code = code;
    this.path = path;
  }
}

export interface StructuralKirArtifact {
  readonly format: typeof STRUCTURAL_KIR_ARTIFACT_FORMAT;
  readonly constitution: string;
  readonly proofLabel: 'ALPHA-NO-GO';
  readonly typeCatalog: {
    readonly format: typeof STRUCTURAL_KIR_TYPE_CATALOG_FORMAT;
    readonly admittedKinds: readonly [];
  };
  readonly root: StructuralKirNode;
}

export type StructuralPropertyValue = CanonicalValue;
