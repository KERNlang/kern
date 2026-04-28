/**
 * Module Generators — import.
 *
 * NOTE: generateModule remains in codegen-core.ts because it calls
 * generateCoreNode recursively for inline child definitions.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import { propsOf } from '../node-props.js';
import type { IRNode } from '../types.js';
import { emitIdentifier, emitImportSpecifier } from './emitters.js';
import { getChildren, getProps } from './helpers.js';

const _p = getProps;
const kids = getChildren;

// ── Import ──────────────────────────────────────────────────────────────

export function generateImport(node: IRNode): string[] {
  const props = propsOf<'import'>(node);
  const from = props.from;
  const names = props.names;
  const defaultImport = props.default;
  const isTypeOnly = props.types === 'true' || props.types === true;

  if (!from) return [];

  const safePath = emitImportSpecifier(from, node);
  const typeKw = isTypeOnly ? 'type ' : '';
  const safeDefault = defaultImport ? emitIdentifier(defaultImport, 'default', node) : '';
  const namedList = names
    ? names
        .split(',')
        .map((s) => emitIdentifier(s.trim(), 'import', node))
        .join(', ')
    : '';

  if (safeDefault && namedList) {
    return [`import ${typeKw}${safeDefault}, { ${namedList} } from '${safePath}';`];
  }
  if (safeDefault) {
    return [`import ${typeKw}${safeDefault} from '${safePath}';`];
  }
  if (namedList) {
    return [`import ${typeKw}{ ${namedList} } from '${safePath}';`];
  }
  // Side-effect import
  return [`import '${safePath}';`];
}

// ── Use (cross-`.kern` symbol resolution) ───────────────────────────────

/** Translate a `.kern` source path to its compiled `.js` output path. */
function kernPathToJs(path: string): string {
  return path.endsWith('.kern') ? `${path.slice(0, -'.kern'.length)}.js` : path;
}

export function generateUse(node: IRNode): string[] {
  const props = propsOf<'use'>(node);
  const path = props.path;
  if (!path) return [];

  const safePath = emitImportSpecifier(kernPathToJs(path), node);
  const fromChildren = kids(node, 'from');
  if (fromChildren.length === 0) {
    // Side-effect-only `use path="..."` is unusual but legal — emits a
    // bare import for parity with the import node's side-effect form.
    return [`import '${safePath}';`];
  }

  // Every `from` child creates a local binding. `export=true` is an
  // ADDITIONAL re-export marker — it does not replace the local import.
  // (TS `export { x } from '...'` is a forwarding re-export and does NOT
  // create a local binding, so the two lines are independent: an import
  // line for the local binding, plus an export-from line for forwarding.)
  const importBindings: string[] = [];
  const reExportBindings: string[] = [];
  for (const child of fromChildren) {
    const cp = propsOf<'from'>(child);
    const name = cp.name;
    if (!name) continue;
    const safeName = emitIdentifier(name, 'imported', child);
    const aliasRaw = cp.as;
    const safeAlias = aliasRaw ? emitIdentifier(aliasRaw, 'alias', child) : '';
    const isReExport = cp.export === 'true' || cp.export === true;

    const binding = safeAlias ? `${safeName} as ${safeAlias}` : safeName;
    importBindings.push(binding);
    if (isReExport) {
      // Mirror the same `name as alias` form so the re-exported name matches
      // what consumers will see (`bar`, not `foo`) when an alias is set.
      reExportBindings.push(binding);
    }
  }

  const lines: string[] = [];
  if (importBindings.length > 0) {
    lines.push(`import { ${importBindings.join(', ')} } from '${safePath}';`);
  }
  if (reExportBindings.length > 0) {
    lines.push(`export { ${reExportBindings.join(', ')} } from '${safePath}';`);
  }
  return lines;
}
