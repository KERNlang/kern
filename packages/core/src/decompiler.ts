import { STYLE_SHORTHANDS, VALUE_SHORTHANDS } from './spec.js';
import type { DecompileResult, ExprObject, IRNode } from './types.js';

function expandKey(key: string): string {
  return STYLE_SHORTHANDS[key] || key;
}

function expandVal(val: string): string {
  return VALUE_SHORTHANDS[val] || val;
}

/**
 * Decompile an IR tree back to a human-readable text representation.
 *
 * Useful for debugging, diffing, and displaying IR to users. Expands style
 * shorthands and value aliases for readability.
 *
 * @param root - The root IRNode to decompile
 * @returns `{ code: string }` — the human-readable representation
 */
export function decompile(root: IRNode): DecompileResult {
  const lines: string[] = [];

  function render(node: IRNode, indent: string): void {
    if (!node.type) {
      lines.push(`${indent}[unknown node]`);
      return;
    }
    const props = node.props || {};

    // Canonical-grammar cases — emit re-parseable KERN. Other node types
    // still fall through to the debug-shape serializer below; make them
    // canonical in a follow-up PR.
    if (node.type === 'each') {
      renderEach(node, indent);
      return;
    }
    if (node.type === 'let') {
      renderLet(node, indent);
      return;
    }

    const name = (props.name as string) || '';
    const type = node.type.charAt(0).toUpperCase() + node.type.slice(1);

    // Style description
    const styles =
      props.styles && typeof props.styles === 'object' && !Array.isArray(props.styles)
        ? (props.styles as Record<string, string>)
        : undefined;
    const styleDesc = styles
      ? Object.entries(styles)
          .map(([k, v]) => `${expandKey(k)}: ${expandVal(String(v))}`)
          .join(', ')
      : '';

    // Props (excluding internal keys)
    const propEntries = Object.entries(props)
      .filter(([k]) => k !== 'styles' && k !== 'pseudoStyles' && k !== 'themeRefs')
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');

    let desc = `${indent}${type}`;
    if (name) desc += ` "${name}"`;
    if (propEntries) desc += ` (${propEntries})`;
    if (styleDesc) desc += ` [${styleDesc}]`;

    const themeRefs = props.themeRefs as string[] | undefined;
    if (themeRefs?.length) desc += ` inherits ${themeRefs.map((r) => `$${r}`).join(', ')}`;

    lines.push(desc);

    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  function renderLet(node: IRNode, indent: string): void {
    const props = node.props || {};
    const name = (props.name as string) || 'binding';
    const rawExpr = props.expr;
    const expr =
      rawExpr && typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
        ? (rawExpr as ExprObject).code
        : (rawExpr as string) || '';
    const t = props.type as string | undefined;
    const parts: string[] = [`let name=${name}`, `expr=${JSON.stringify(expr)}`];
    if (t) parts.push(`type=${t}`);
    lines.push(`${indent}${parts.join(' ')}`);
    // `let` has no children in normal use, but preserve generic recursion.
    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  function renderEach(node: IRNode, indent: string): void {
    const props = node.props || {};
    const name = (props.name as string) || 'item';
    const rawIn = props.in;
    const inExpr =
      rawIn && typeof rawIn === 'object' && (rawIn as ExprObject).__expr
        ? (rawIn as ExprObject).code
        : (rawIn as string) || '';
    const index = (props.index as string) || '';
    const rawKey = props.key;
    const keyExpr =
      rawKey && typeof rawKey === 'object' && (rawKey as ExprObject).__expr
        ? (rawKey as ExprObject).code
        : typeof rawKey === 'string'
          ? rawKey
          : '';

    const parts: string[] = [`each name=${name}`, `in=${JSON.stringify(inExpr)}`];
    if (index) parts.push(`index=${index}`);
    if (keyExpr) parts.push(`key=${JSON.stringify(keyExpr)}`);
    lines.push(`${indent}${parts.join(' ')}`);

    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  render(root, '');
  return { code: lines.join('\n') };
}
