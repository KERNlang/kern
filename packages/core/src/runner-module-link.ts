import type { IRNode } from './types.js';

/**
 * Shared module-linking vocabulary for the native runner.
 *
 * The capability preflight ({@link ./runner-capability-plan.ts}) and the runtime
 * linker ({@link ./runner.ts}) must reject and accept EXACTLY the same import
 * graphs — a preflight that green-lights a program the executor then refuses (or
 * vice versa) is a fail-open divergence. This module is the single source of
 * truth for (a) the link-error message strings both paths emit and (b) how a
 * module's explicit export set (own `export=true` declarations) is computed, so
 * the two can never drift.
 *
 * It depends only on the (type-only) IR node shape, so importing it keeps the
 * TypeScript-free browser runner entry closure clean.
 */

export type RunnerModuleExportKind = 'fn' | 'class';

export interface RunnerModuleExportRecord {
  readonly kind: RunnerModuleExportKind;
  readonly sourceName: string;
}

const PREFIX = 'link error';

/** Canonical link-error messages shared by preflight and executor. */
export const moduleLinkErrors = {
  useMissingPath: (importer: string): string => `${PREFIX}: use in '${importer}' must declare path=`,
  cannotResolve: (rawPath: string, importer: string): string =>
    `${PREFIX}: cannot resolve import '${rawPath}' from '${importer}'`,
  cannotResolveNoLoader: (rawPath: string, importer: string): string =>
    `${PREFIX}: cannot resolve import '${rawPath}' from '${importer}' without a module loader`,
  missingLoader: (path: string): string => `${PREFIX}: missing module loader for '${path}'`,
  importMissingName: (rawPath: string, importer: string): string =>
    `${PREFIX}: import from '${rawPath}' in '${importer}' must declare name=`,
  aliasNotPortable: (localName: string, importer: string): string =>
    `${PREFIX}: import alias '${localName}' in '${importer}' is not portable`,
  duplicateAlias: (localName: string, importer: string): string =>
    `${PREFIX}: duplicate imported alias '${localName}' in '${importer}'`,
  duplicateExport: (localName: string, path: string): string => `${PREFIX}: duplicate export '${localName}' in '${path}'`,
  doesNotExport: (targetPath: string, name: string, importer: string): string =>
    `${PREFIX}: module '${targetPath}' does not export '${name}' imported by '${importer}'`,
  kindMismatch: (importedName: string, targetPath: string, expected: string, found: string): string =>
    `${PREFIX}: import '${importedName}' from '${targetPath}' expected kind '${expected}' but found '${found}'`,
  importedMain: (path: string): string => `${PREFIX}: imported module '${path}' must not declare fn main`,
  importCycle: (path: string): string => `${PREFIX}: import cycle involving '${path}'`,
  aliasConflicts: (localName: string, path: string): string =>
    `${PREFIX}: imported alias '${localName}' conflicts in '${path}'`,
  unreadableSource: (path: string): string => `${PREFIX}: module '${path}' source is unavailable`,
} as const;

function topLevelDeclarations(root: IRNode): readonly IRNode[] {
  return root.type === 'document' ? (root.children ?? []) : [];
}

function isExportFlag(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * The set of names a module exports via its OWN top-level `export=true` `fn` /
 * `class` declarations (re-exports are represented as separate import edges and
 * resolved by each linker's import walk). Shared verbatim by the preflight and
 * executor so both agree on what a module exports and of what kind.
 */
export function ownExplicitExportKinds(root: IRNode): Map<string, RunnerModuleExportRecord> {
  const out = new Map<string, RunnerModuleExportRecord>();
  for (const node of topLevelDeclarations(root)) {
    if (!isExportFlag(node.props?.export)) continue;
    const name = node.props?.name;
    if (typeof name !== 'string' || name === '') continue;
    if (node.type === 'fn') out.set(name, { kind: 'fn', sourceName: name });
    else if (node.type === 'class') out.set(name, { kind: 'class', sourceName: name });
  }
  return out;
}
