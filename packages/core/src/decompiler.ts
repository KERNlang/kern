import type { IRNode, DecompileResult } from './types.js';
import { STYLE_SHORTHANDS, VALUE_SHORTHANDS } from './spec.js';

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
    const name = (props.name as string) || '';
    const type = node.type.charAt(0).toUpperCase() + node.type.slice(1);

    // Style description
    const styles = (props.styles && typeof props.styles === 'object' && !Array.isArray(props.styles))
      ? props.styles as Record<string, string>
      : undefined;
    const styleDesc = styles
      ? Object.entries(styles).map(([k, v]) => `${expandKey(k)}: ${expandVal(String(v))}`).join(', ')
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
    if (themeRefs?.length) desc += ` inherits ${themeRefs.map(r => `$${r}`).join(', ')}`;

    lines.push(desc);

    if (node.children) {
      for (const child of node.children) {
        render(child, indent + '  ');
      }
    }
  }

  render(root, '');
  return { code: lines.join('\n') };
}
