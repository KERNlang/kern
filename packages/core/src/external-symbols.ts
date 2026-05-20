import { type ExternalSignatureMap } from './ecosystem-signatures.js';
import {
  collectExternalBoundaries,
  collectSidecarManifests,
  type ExternalBoundary,
  type ExternalImportBinding,
  type SidecarManifest,
  type SidecarPackage,
} from './external-boundary.js';
import {
  externalNamedBindingSignature,
  externalSignatureMapForSidecarPackage,
  externalSymbolsFromSidecarManifest,
  parseExternalNamedBinding as parseExternalNamedBindingGenerated,
} from './external-symbol-utils.js';
import type { ExternalImportRegistry, ExternalImportTarget } from './import-metadata.js';
import type { IRNode } from './types.js';

export interface ExternalNamedBinding {
  name: string;
  alias: string;
}

export type ExternalImportSymbolKind = 'module' | 'function' | 'type' | 'sideEffect';

export interface ExternalImportSymbol {
  localName: string;
  kind: ExternalImportSymbolKind;
  package: string;
  registry: ExternalImportRegistry;
  target: ExternalImportTarget;
  targetFamily: 'all' | 'ts' | 'python' | 'none';
  from?: string;
  sourceName?: string;
  signature?: string;
  signatures?: ExternalSignatureMap;
  sidecarName?: string;
  runtime?: string;
  boundary?: ExternalBoundary;
  binding?: ExternalImportBinding;
  line?: number;
  col?: number;
}

export interface ExternalImportSymbolTable {
  symbols: ExternalImportSymbol[];
  byLocalName: Map<string, ExternalImportSymbol>;
  byPackage: Map<string, ExternalImportSymbol[]>;
  conflicts: ExternalImportSymbolConflict[];
}

export interface ExternalImportSymbolConflict {
  localName: string;
  symbols: ExternalImportSymbol[];
}

export interface ExternalSignatureDiagnostic {
  package: string;
  registry: ExternalImportRegistry;
  name: string;
  reason: 'not-imported';
  line?: number;
  col?: number;
}

export function parseExternalNamedBinding(raw: string): ExternalNamedBinding | null {
  return parseExternalNamedBindingGenerated(raw);
}

export function signatureMapForSidecarPackage(sidecarPackage: SidecarPackage): ExternalSignatureMap {
  return externalSignatureMapForSidecarPackage(sidecarPackage);
}

export function collectExternalImportSymbols(root: IRNode): ExternalImportSymbolTable {
  return buildExternalImportSymbolTable(collectExternalBoundaries(root), collectSidecarManifests(root));
}

export function buildExternalImportSymbolTable(
  boundaries: ExternalBoundary[],
  sidecarManifests: SidecarManifest[] = [],
): ExternalImportSymbolTable {
  const symbols: ExternalImportSymbol[] = [];
  for (const boundary of boundaries) {
    if (isSidecarBackedPythonBoundary(boundary)) {
      for (const symbol of typeOnlySymbolsFromBoundary(boundary)) symbols.push(symbol);
      continue;
    }
    for (const symbol of symbolsFromBoundary(boundary)) symbols.push(symbol);
  }
  for (const manifest of sidecarManifests) {
    for (const symbol of symbolsFromSidecarManifest(manifest)) symbols.push(symbol);
  }
  return indexSymbols(symbols);
}

function isSidecarBackedPythonBoundary(boundary: ExternalBoundary): boolean {
  return (
    (boundary.registry === 'pypi' || boundary.targetFamily === 'python') &&
    hasRuntimeImports(boundary) &&
    (boundary.explicitPackage === true || boundary.island?.requiresSidecar === true)
  );
}

function hasRuntimeImports(boundary: ExternalBoundary): boolean {
  return boundary.imports.some((binding) => binding.types !== true);
}

function typeOnlySymbolsFromBoundary(boundary: ExternalBoundary): ExternalImportSymbol[] {
  const filteredBoundary = {
    ...boundary,
    imports: boundary.imports.filter((binding) => binding.types === true),
  };
  return symbolsFromBoundary(filteredBoundary).map((symbol) => ({ ...symbol, boundary }));
}

export function externalSignatureDiagnostics(root: IRNode): ExternalSignatureDiagnostic[] {
  const diagnostics: ExternalSignatureDiagnostic[] = [];
  for (const boundary of collectExternalBoundaries(root)) {
    for (const binding of boundary.imports) {
      const signatures = binding.signatures;
      if (!signatures) continue;
      if (binding.default || binding.names.length === 0) continue;
      const imported = new Set<string>();
      for (const rawName of binding.names) {
        const namedBinding = parseExternalNamedBinding(rawName);
        if (namedBinding) imported.add(namedBinding.name);
      }
      for (const name of Object.keys(signatures)) {
        if (imported.has(name)) continue;
        diagnostics.push({
          package: boundary.package,
          registry: boundary.registry,
          name,
          reason: 'not-imported',
          line: binding.line ?? boundary.line,
          col: binding.col ?? boundary.col,
        });
      }
    }
  }
  return diagnostics;
}

function symbolsFromBoundary(boundary: ExternalBoundary): ExternalImportSymbol[] {
  const symbols: ExternalImportSymbol[] = [];
  for (const binding of boundary.imports) {
    if (binding.default) {
      symbols.push({
        localName: binding.default,
        kind: binding.types ? 'type' : 'module',
        package: boundary.package,
        registry: boundary.registry,
        target: boundary.target,
        targetFamily: boundary.targetFamily,
        from: binding.from,
        signatures: binding.signatures,
        runtime: boundary.runtime,
        boundary,
        binding,
        line: binding.line ?? boundary.line,
        col: binding.col ?? boundary.col,
      });
    }
    for (const rawName of binding.names) {
      const namedBinding = parseExternalNamedBinding(rawName);
      if (!namedBinding) continue;
      symbols.push({
        localName: namedBinding.alias,
        kind: binding.types ? 'type' : 'function',
        package: boundary.package,
        registry: boundary.registry,
        target: boundary.target,
        targetFamily: boundary.targetFamily,
        from: binding.from,
        sourceName: namedBinding.name,
        signature: externalNamedBindingSignature(binding, namedBinding.name),
        runtime: boundary.runtime,
        boundary,
        binding,
        line: binding.line ?? boundary.line,
        col: binding.col ?? boundary.col,
      });
    }
    if (!binding.default && binding.names.length === 0 && !binding.types) {
      symbols.push({
        localName: binding.from ?? boundary.package,
        kind: 'sideEffect',
        package: boundary.package,
        registry: boundary.registry,
        target: boundary.target,
        targetFamily: boundary.targetFamily,
        from: binding.from,
        runtime: boundary.runtime,
        boundary,
        binding,
        line: binding.line ?? boundary.line,
        col: binding.col ?? boundary.col,
      });
    }
  }
  return symbols;
}

function symbolsFromSidecarManifest(manifest: SidecarManifest): ExternalImportSymbol[] {
  return externalSymbolsFromSidecarManifest(manifest);
}

function indexSymbols(symbols: ExternalImportSymbol[]): ExternalImportSymbolTable {
  const byLocalName = new Map<string, ExternalImportSymbol>();
  const byPackage = new Map<string, ExternalImportSymbol[]>();
  const symbolsByLocalName = new Map<string, ExternalImportSymbol[]>();
  for (const symbol of symbols) {
    if (!byLocalName.has(symbol.localName)) byLocalName.set(symbol.localName, symbol);
    const localSymbols = symbolsByLocalName.get(symbol.localName) ?? [];
    localSymbols.push(symbol);
    symbolsByLocalName.set(symbol.localName, localSymbols);
    const packageSymbols = byPackage.get(symbol.package) ?? [];
    packageSymbols.push(symbol);
    byPackage.set(symbol.package, packageSymbols);
  }
  const conflicts = [...symbolsByLocalName.entries()]
    .filter(([, localSymbols]) => hasExternalImportSymbolConflict(localSymbols))
    .map(([localName, localSymbols]) => ({ localName, symbols: localSymbols }));
  return { symbols, byLocalName, byPackage, conflicts };
}

function hasExternalImportSymbolConflict(symbols: ExternalImportSymbol[]): boolean {
  let valueCount = 0;
  let typeCount = 0;
  for (const symbol of symbols) {
    if (symbol.kind === 'type') typeCount++;
    else valueCount++;
    if (valueCount > 1 || typeCount > 1) return true;
  }
  return false;
}
