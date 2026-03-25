import type { IRNode, DiagnosticOutcome, TranspileDiagnostic } from './types.js';

export function countTokens(text: string): number {
  return text.split(/[\s{}()\[\];,.<>:='"]+/).filter(Boolean).length;
}

export function serializeIR(node: IRNode, indent = ''): string {
  let line = `${indent}${node.type}`;
  const props = node.props || {};
  for (const [k, v] of Object.entries(props)) {
    if (k === 'styles' || k === 'pseudoStyles' || k === 'themeRefs') continue;
    const sv = String(v);
    const needsQuote = typeof v === 'string' && (sv.includes(' ') || sv.includes('"'));
    line += ` ${k}=${needsQuote ? `"${sv.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : sv}`;
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

/** Escape text content for JSX — prevents XSS in rendered HTML */
export function escapeJsxText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

/** Escape attribute values for JSX — prevents XSS in attributes */
export function escapeJsxAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape strings for JS string literals (single-quoted) */
export function escapeJsString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** @deprecated Use escapeJsxText, escapeJsxAttr, or escapeJsString */
export function escapeJsx(s: string): string {
  return escapeJsxText(s);
}

// ── Transpile Diagnostics ─────────────────────────────────────────────────

export type AccountedEntry = { outcome: DiagnosticOutcome; reason?: string };

/** Mark a node (and optionally all its descendants) as accounted for in the tracking map. */
export function accountNode(
  map: Map<IRNode, AccountedEntry>,
  node: IRNode,
  outcome: DiagnosticOutcome,
  reason?: string,
  recursive = false,
): void {
  map.set(node, { outcome, reason });
  if (recursive && node.children) {
    for (const child of node.children) {
      accountNode(map, child, outcome, reason, true);
    }
  }
}

/** Build diagnostics by diffing all IR nodes against the accounted map. Root-cause-only reporting. */
export function buildDiagnostics(
  root: IRNode,
  accounted: Map<IRNode, AccountedEntry>,
  target: string,
): TranspileDiagnostic[] {
  const diagnostics: TranspileDiagnostic[] = [];

  function countUnaccountedDescendants(node: IRNode): number {
    let count = 0;
    for (const child of node.children || []) {
      if (!accounted.has(child)) {
        count += 1 + countUnaccountedDescendants(child);
      }
    }
    return count;
  }

  function walk(node: IRNode, parentUnsupported: boolean): void {
    const entry = accounted.get(node);

    if (entry) {
      if (entry.outcome !== 'expressed') {
        diagnostics.push({
          nodeType: node.type,
          outcome: entry.outcome,
          target,
          loc: node.loc ? { line: node.loc.line, col: node.loc.col } : undefined,
          reason: entry.reason,
        });
      }
      for (const child of node.children || []) walk(child, false);
    } else if (parentUnsupported) {
      for (const child of node.children || []) walk(child, true);
    } else {
      const lost = countUnaccountedDescendants(node);
      diagnostics.push({
        nodeType: node.type,
        outcome: 'unsupported',
        target,
        loc: node.loc ? { line: node.loc.line, col: node.loc.col } : undefined,
        childrenLost: lost || undefined,
      });
      for (const child of node.children || []) walk(child, true);
    }
  }

  walk(root, false);
  return diagnostics;
}
