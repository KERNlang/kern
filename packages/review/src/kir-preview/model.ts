import type { ModuleKirArtifact } from '@kernlang/core/frontend-projection';
import type { CanonicalKirFacet } from './types.js';

export type StructuralKirNodeView = ModuleKirArtifact['modules'][number]['roots'][number];
export type CanonicalRecordEntry = StructuralKirNodeView['properties'][number];
export type CanonicalValue = CanonicalRecordEntry['value'];

export interface VerifiedProjectionView {
  readonly artifact: ModuleKirArtifact;
  readonly receipt: {
    readonly requestDigest: string;
    readonly artifactDigest: string;
  };
}

export interface KirFact {
  readonly facet: CanonicalKirFacet;
  readonly moduleId: string;
  readonly key: string;
  readonly matchKey: string;
  readonly value: string;
  readonly display: string;
  readonly contentIdentity?: string;
}

export interface CanonicalKirFactModel {
  readonly facts: readonly KirFact[];
  readonly semanticDigest: string;
}
