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

  // Split bindings: regular imports vs re-export-marked bindings.
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
    if (isReExport) {
      // Re-exports use the OUTGOING name (alias if present, otherwise the
      // original) on both sides — the export shape is `export { localName }`
      // so a chain of `use foo as bar export=true` re-exports the local
      // binding `bar`. To preserve the source-of-truth name when there is
      // an alias, emit `export { foo as bar } from '...'` directly so the
      // re-export and the local import agree.
      reExportBindings.push(binding);
    } else {
      importBindings.push(binding);
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
