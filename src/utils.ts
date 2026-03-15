import type { IRNode } from './types.js';

export function countTokens(text: string): number {
  return text.split(/[\s{}()\[\];,.<>:='"]+/).filter(Boolean).length;
}

export function serializeIR(node: IRNode, indent = ''): string {
  let line = `${indent}${node.type}`;
  const props = node.props || {};
  for (const [k, v] of Object.entries(props)) {
    if (k === 'styles' || k === 'pseudoStyles' || k === 'themeRefs') continue;
    line += ` ${k}=${typeof v === 'string' && v.includes(' ') ? `"${v}"` : v}`;
  }
  if (props.styles) {
    const pairs = Object.entries(props.styles as Record<string, string>)
      .map(([k, v]) => `${k}:${v}`).join(',');
    line += ` {${pairs}}`;
  }
  if (props.themeRefs) {
    for (const ref of props.themeRefs as string[]) {
      line += ` $${ref}`;
    }
  }
  let result = line + '\n';
  if (node.children) {
    for (const child of node.children) {
      result += serializeIR(child, indent + '  ');
    }
  }
  return result;
}

export function camelKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
}

export function escapeJsx(s: string): string {
  return s.replace(/'/g, "\\'");
}
