import type { CanonicalValueLimits } from '../canonical-value/types.js';
import type { KirEvidenceInput } from '../kir-evidence/types.js';

export const KIR_V1_FORMAT = 'kern.kir.v1' as const;
export const KIR_V1_PROFILE = 'kern.kir.profile.v1' as const;
export const KIR_V1_COMPONENT_KINDS = ['semantic-module', 'diagnostic-evidence'] as const;

export interface KirV1Input {
  readonly semanticBytes: Uint8Array;
  readonly evidenceBytes: Uint8Array;
}

export interface KirV1Artifact extends KirV1Input {
  readonly format: typeof KIR_V1_FORMAT;
  readonly profile: typeof KIR_V1_PROFILE;
  readonly semanticSha256: string;
  readonly evidenceSha256: string;
}

export interface KirV1CodecOptions {
  readonly limits: CanonicalValueLimits;
}

export type KirV1Sources = readonly KirEvidenceInput['sources'][number][];

export type KirV1ErrorCode =
  | 'invalid-kir-v1'
  | 'unsupported-kir-v1'
  | 'invalid-components'
  | 'invalid-component'
  | 'digest-mismatch'
  | 'invalid-payload';

export class KirV1Error extends TypeError {
  readonly code: KirV1ErrorCode;
  readonly path: string;

  constructor(code: KirV1ErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'KirV1Error';
    this.code = code;
    this.path = path;
  }
}
