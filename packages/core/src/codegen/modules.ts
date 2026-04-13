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
import { getProps } from './helpers.js';

const _p = getProps;

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
