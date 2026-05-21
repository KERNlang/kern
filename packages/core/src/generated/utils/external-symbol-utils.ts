// @kern-source: external-symbol-utils:1
import { inferExternalSignatureMap } from './ecosystem-signatures.js';
import type { ExternalSignatureMap } from './ecosystem-signatures.js';

// @kern-source: external-symbol-utils:4
import type { ExternalRuntimeImportShape, ExternalSidecarManifestShape, ExternalSidecarPackageShape } from './external-boundary-utils.js';

// @kern-source: external-symbol-utils:8
import type { ExternalImportRegistry, ExternalImportTarget, ExternalImportTargetFamily } from './import-metadata.js';

// @kern-source: external-symbol-utils:13
export type ExternalNamedBindingShape = { name: string; alias: string };

// @kern-source: external-symbol-utils:14
export type ExternalImportSymbolKindShape = 'module' | 'function' | 'type' | 'sideEffect';

// @kern-source: external-symbol-utils:15
export type ExternalImportSymbolShape = { localName: string; kind: ExternalImportSymbolKindShape; package: string; registry: ExternalImportRegistry; target: ExternalImportTarget; targetFamily: ExternalImportTargetFamily; from?: string; sourceName?: string; signature?: string; signatures?: ExternalSignatureMap; sidecarName?: string; runtime?: string; binding?: ExternalRuntimeImportShape; line?: number; col?: number };

// @kern-source: external-symbol-utils:17
export function parseExternalNamedBindingShape(raw: string): ExternalNamedBindingShape | null {
  const match = raw.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u);
  if (!match) return null;
  return { name: match[1], alias: match[2] ?? match[1] };
}

// @kern-source: external-symbol-utils:25
export function externalNamedBindingSignature(binding: ExternalRuntimeImportShape, name: string): string | undefined {
  if (binding.names.length === 1) {
    return binding.signature ?? binding.signatures?.[name];
  }
  return binding.signatures?.[name];
}

// @kern-source: external-symbol-utils:33
export function isExternalSafeIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value);
}

// @kern-source: external-symbol-utils:38
export function externalSignatureMapForSidecarPackage(sidecarPackage: ExternalSidecarPackageShape): ExternalSignatureMap {
  const signatures: ExternalSignatureMap = {
    ...(inferExternalSignatureMap(sidecarPackage.registry, sidecarPackage.package) ?? {}),
  };
  for (const binding of sidecarPackage.imports) {
    if (binding.signatures && (binding.default || binding.names.length === 0)) {
      Object.assign(signatures, binding.signatures);
    }
    for (const rawName of binding.names) {
      const namedBinding = parseExternalNamedBindingShape(rawName);
      if (!namedBinding) continue;
      const signature = binding.signatures?.[namedBinding.name];
      if (signature) signatures[namedBinding.name] = signature;
    }
    if (binding.signature && binding.names.length === 1) {
      const namedBinding = parseExternalNamedBindingShape(binding.names[0]);
      if (namedBinding) signatures[namedBinding.name] = binding.signature;
    }
  }
  return signatures;
}

// @kern-source: external-symbol-utils:62
export function externalSymbolsFromSidecarManifest(manifest: ExternalSidecarManifestShape): ExternalImportSymbolShape[] {
  const symbols: ExternalImportSymbolShape[] = [];
  for (const sidecarPackage of manifest.packages) {
    const signatures = externalSignatureMapForSidecarPackage(sidecarPackage);
    const moduleAliases = new Set<string>();
    for (const binding of sidecarPackage.imports) {
      if (binding.default) moduleAliases.add(binding.default);
    }
    if (moduleAliases.size === 0 && isExternalSafeIdentifier(sidecarPackage.package)) {
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
        const namedBinding = parseExternalNamedBindingShape(rawName);
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

