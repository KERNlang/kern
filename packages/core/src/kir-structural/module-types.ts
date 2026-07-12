import type { CanonicalValueLimits } from '../canonical-value/types.js';
import type { IRNode } from '../types.js';
import type { StructuralKirNode } from './types.js';

export const MODULE_KIR_ARTIFACT_FORMAT = 'kern.kir.modules.r1.5c.3-alpha' as const;
export const MODULE_KIR_SYMBOL_CATALOG_FORMAT = 'kern.symbol-admission.r1.5c.3' as const;
export const MODULE_KIR_SYMBOL_KINDS = ['class', 'fn'] as const;
export const MODULE_KIR_ROOT_KINDS = ['class', 'fn', 'from', 'module', 'use'] as const;

export type ModuleKirSymbolKind = (typeof MODULE_KIR_SYMBOL_KINDS)[number];

export interface ModuleKirInput {
  readonly id: string;
  readonly roots: readonly IRNode[];
}

export interface ModuleKirBinding {
  readonly imported: string;
  readonly kind: ModuleKirSymbolKind;
  readonly local: string;
  readonly reexport: boolean;
}

export interface ModuleKirImport {
  readonly bindings: readonly ModuleKirBinding[];
  readonly source: string;
}

export interface ModuleKirExport {
  readonly kind: ModuleKirSymbolKind;
  readonly name: string;
  readonly source: string | null;
}

export interface ModuleKirModule {
  readonly exports: readonly ModuleKirExport[];
  readonly id: string;
  readonly imports: readonly ModuleKirImport[];
  readonly roots: readonly StructuralKirNode[];
}

export interface ModuleKirArtifact {
  readonly constitution: string;
  readonly diagnostics: readonly [];
  readonly format: typeof MODULE_KIR_ARTIFACT_FORMAT;
  readonly modules: readonly ModuleKirModule[];
  readonly proofLabel: 'ALPHA-NO-GO';
  readonly symbolCatalog: {
    readonly admittedKinds: typeof MODULE_KIR_SYMBOL_KINDS;
    readonly format: typeof MODULE_KIR_SYMBOL_CATALOG_FORMAT;
  };
}

export type ModuleKirErrorCode =
  | 'invalid-module-artifact'
  | 'unsupported-module-version'
  | 'invalid-module-id'
  | 'invalid-module-root'
  | 'invalid-symbol'
  | 'missing-module'
  | 'missing-export'
  | 'kind-mismatch'
  | 'duplicate-local-binding'
  | 'duplicate-export'
  | 'module-cycle'
  | 'metadata-mismatch';

export class ModuleKirError extends TypeError {
  readonly code: ModuleKirErrorCode;
  readonly path: string;

  constructor(code: ModuleKirErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ModuleKirError';
    this.code = code;
    this.path = path;
  }
}

export interface ModuleKirCodecOptions {
  readonly limits: CanonicalValueLimits;
}
