import { type ExternalSignatureMap, inferExternalSignatureMap } from './ecosystem-signatures.js';
import {
  collectExternalBoundaries,
  collectSidecarManifests,
  type ExternalBoundary,
  type ExternalImportBinding,
  type SidecarManifest,
  type SidecarPackage,
} from './external-boundary.js';
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
}

export interface ExternalSignatureDiagnostic {
  package: string;
  registry: ExternalImportRegistry;
  name: string;
  reason: 'not-imported';
  line?: number;
  col?: number;
}

const SAFE_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

export function parseExternalNamedBinding(raw: string): ExternalNamedBinding | null {
  const match = raw.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u);
  if (!match) return null;
  return { name: match[1], alias: match[2] ?? match[1] };
}

export function signatureMapForSidecarPackage(sidecarPackage: SidecarPackage): ExternalSignatureMap {
  const signatures: ExternalSignatureMap = {
    ...(inferExternalSignatureMap(sidecarPackage.registry, sidecarPackage.package) ?? {}),
  };
  for (const binding of sidecarPackage.imports) {
    if (binding.signatures && (binding.default || binding.names.length === 0)) {
      Object.assign(signatures, binding.signatures);
    }
    for (const rawName of binding.names) {
      const namedBinding = parseExternalNamedBinding(rawName);
      if (!namedBinding) continue;
      const signature = binding.signatures?.[namedBinding.name];
      if (signature) signatures[namedBinding.name] = signature;
    }
    if (binding.signature && binding.names.length === 1) {
      const namedBinding = parseExternalNamedBinding(binding.names[0]);
      if (namedBinding) signatures[namedBinding.name] = binding.signature;
    }
  }
  return signatures;
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
    if (isSidecarBackedPythonBoundary(boundary)) continue;
    for (const symbol of symbolsFromBoundary(boundary)) symbols.push(symbol);
  }
  for (const manifest of sidecarManifests) {
    for (const symbol of symbolsFromSidecarManifest(manifest)) symbols.push(symbol);
  }
  return indexSymbols(symbols);
}

function isSidecarBackedPythonBoundary(boundary: ExternalBoundary): boolean {
  return (
    boundary.registry === 'pypi' &&
    hasRuntimeImports(boundary) &&
    (boundary.explicitPackage === true || boundary.island?.requiresSidecar === true)
  );
}

function hasRuntimeImports(boundary: ExternalBoundary): boolean {
  return boundary.imports.some((binding) => binding.types !== true);
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
        signature: binding.names.length === 1 ? binding.signature : binding.signatures?.[namedBinding.name],
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
  const symbols: ExternalImportSymbol[] = [];
  for (const sidecarPackage of manifest.packages) {
    const signatures = signatureMapForSidecarPackage(sidecarPackage);
    const moduleAliases = new Set<string>();
    for (const binding of sidecarPackage.imports) {
      if (binding.default) moduleAliases.add(binding.default);
    }
    if (moduleAliases.size === 0 && SAFE_IDENTIFIER_RE.test(sidecarPackage.package)) {
      moduleAliases.add(sidecarPackage.package);
    }
    for (const localName of moduleAliases) {
      symbols.push({
        localName,
        kind: 'module',
        package: sidecarPackage.package,
        registry: sidecarPackage.registry,
        target: sidecarPackage.target,
        targetFamily: sidecarPackage.targetFamily,
        signatures,
        sidecarName: manifest.name,
        runtime: manifest.runtime,
        line: sidecarPackage.line ?? manifest.line,
        col: sidecarPackage.col ?? manifest.col,
      });
    }
    for (const binding of sidecarPackage.imports) {
      for (const rawName of binding.names) {
        const namedBinding = parseExternalNamedBinding(rawName);
        if (!namedBinding) continue;
        symbols.push({
          localName: namedBinding.alias,
          kind: 'function',
          package: sidecarPackage.package,
          registry: sidecarPackage.registry,
          target: sidecarPackage.target,
          targetFamily: sidecarPackage.targetFamily,
          from: binding.from,
          sourceName: namedBinding.name,
          signature: signatures[namedBinding.name],
          sidecarName: manifest.name,
          runtime: manifest.runtime,
          binding,
          line: binding.line ?? sidecarPackage.line ?? manifest.line,
          col: binding.col ?? sidecarPackage.col ?? manifest.col,
        });
      }
    }
  }
  return symbols;
}

function indexSymbols(symbols: ExternalImportSymbol[]): ExternalImportSymbolTable {
  const byLocalName = new Map<string, ExternalImportSymbol>();
  const byPackage = new Map<string, ExternalImportSymbol[]>();
  for (const symbol of symbols) {
    if (!byLocalName.has(symbol.localName)) byLocalName.set(symbol.localName, symbol);
    const packageSymbols = byPackage.get(symbol.package) ?? [];
    packageSymbols.push(symbol);
    byPackage.set(symbol.package, packageSymbols);
  }
  return { symbols, byLocalName, byPackage };
}
