/**
 * Shared codegen helpers — IR node accessors, string utilities, and annotations.
 *
 * Extracted from codegen-core.ts for independent reuse by React/Vue/Python codegens.
 * These are pure utility functions with no generator dependencies.
 */

import type { IRNode } from '../types.js';

// ── IR Node Accessors ───────────────────────────────────────────────────

export function getProps(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

export function getChildren(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter((n) => n.type === type) : c;
}

export function getFirstChild(node: IRNode, type: string): IRNode | undefined {
  return getChildren(node, type)[0];
}

export function getStyles(node: IRNode): Record<string, string> {
  return (getProps(node).styles as Record<string, string>) || {};
}

export function getPseudoStyles(node: IRNode): Record<string, Record<string, string>> {
  return (getProps(node).pseudoStyles as Record<string, Record<string, string>>) || {};
}

export function getThemeRefs(node: IRNode): string[] {
  return (getProps(node).themeRefs as string[]) || [];
}

export function emitDocBlock(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lines = ['/**'];
  for (const line of trimmed.split('\n')) {
    lines.push(line.trim().length > 0 ? ` * ${line}` : ' *');
  }
  lines.push(' */');
  return lines;
}

export function emitDocComment(node: IRNode): string[] {
  const docs = node.type === 'doc' ? [node] : getChildren(node, 'doc');
  if (docs.length === 0) return [];

  const text = docs
    .map((doc) => {
      const props = getProps(doc);
      return ((props.text as string) || (props.code as string) || '').trim();
    })
    .filter(Boolean)
    .join('\n\n');

  return emitDocBlock(text);
}

// ── String Utilities ────────────────────────────────────────────────────

export function dedent(code: string): string {
  const lines = code.split('\n');
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return code;
  const minIndent = Math.min(...nonEmpty.map((l) => l.match(/^(\s*)/)?.[1]?.length ?? 0));
  return lines
    .map((l) => l.slice(minIndent))
    .join('\n')
    .trim();
}

export function cssPropertyName(camel: string): string {
  return camel.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export function handlerCode(node: IRNode): string {
  const handler = getFirstChild(node, 'handler');
  if (!handler) return '';
  const raw = (getProps(handler).code as string) || '';
  return dedent(raw);
}

export function exportPrefix(node: IRNode): string {
  return getProps(node).export === 'false' ? '' : 'export ';
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Param Parsing ───────────────────────────────────────────────────────

/** Parse "name:Type,name2:Type2,spread:number=8" → "name: Type, name2: Type2, spread: number = 8" */
export function parseParamList(params: string, options?: { stripDefaults?: boolean }): string {
  if (!params) return '';
  return splitParamsRespectingDepth(params)
    .map((s) => {
      const trimmed = s.trim();
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) return trimmed;
      const pname = trimmed.slice(0, colonIdx).trim();
      const rest = trimmed.slice(colonIdx + 1).trim();
      const eqIdx = findDefaultSeparator(rest);
      if (eqIdx === -1) return `${pname}: ${rest}`;
      const ptype = rest.slice(0, eqIdx).trim();
      // TS forbids parameter initializers in overload signatures — only the
      // implementation may carry defaults. Slice 2e callers must strip them.
      if (options?.stripDefaults) return `${pname}: ${ptype}`;
      const pdefault = rest.slice(eqIdx + 1).trim();
      return `${pname}: ${ptype} = ${pdefault}`;
    })
    .join(', ');
}

/** Split param string on commas while respecting <>, (), {} depth. */
function splitParamsRespectingDepth(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '<' || ch === '(' || ch === '{') depth++;
    else if ((ch === '>' || ch === ')' || ch === '}') && depth > 0) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Find '=' separating type from default, skipping '=>' arrows. */
function findDefaultSeparator(rest: string): number {
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '<' || ch === '(' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === '}') depth--;
    else if (ch === '=' && depth === 0) {
      if (rest[i + 1] === '>') continue;
      return i;
    }
  }
  return -1;
}

// ── Source Location Comments ────────────────────────────────────────────

/** Emit a @kern-source comment for tracing generated code back to .kern source. */
export function sourceComment(node: IRNode, sourceFile?: string): string {
  if (!node.loc) return '';
  return `// @kern-source: ${sourceFile || 'unknown'}:${node.loc.line}`;
}

// ── Reason & Confidence Annotations ─────────────────────────────────────

export function emitReasonAnnotations(node: IRNode): string[] {
  const reasonNode = getFirstChild(node, 'reason');
  const evidenceNode = getFirstChild(node, 'evidence');
  const needsNodes = getChildren(node, 'needs');
  const confidence = getProps(node).confidence as string | undefined;

  if (!reasonNode && !evidenceNode && !confidence && needsNodes.length === 0) return [];

  const lines: string[] = ['/**'];
  if (confidence) lines.push(` * @confidence ${confidence}`);
  if (reasonNode) {
    const rp = getProps(reasonNode);
    lines.push(` * @reason ${rp.because || ''}`);
    if (rp.basis) lines.push(` * @basis ${rp.basis}`);
    if (rp.survives) lines.push(` * @survives ${rp.survives}`);
  }
  if (evidenceNode) {
    const ep = getProps(evidenceNode);
    const parts = [`source=${ep.source}`];
    if (ep.method) parts.push(`method=${ep.method}`);
    if (ep.authority) parts.push(`authority=${ep.authority}`);
    lines.push(` * @evidence ${parts.join(', ')}`);
  }
  for (const needsNode of needsNodes) {
    const np = getProps(needsNode);
    const desc = (np.what as string) || (np.description as string) || '';
    const wouldRaise = np['would-raise-to'] as string;
    const tag = wouldRaise ? `${desc} (would raise to ${wouldRaise})` : desc;
    lines.push(` * @needs ${tag}`);
  }
  lines.push(' */');
  return lines;
}

export function emitLowConfidenceTodo(node: IRNode, confidence: string | undefined): string[] {
  if (!confidence) return [];
  const val = parseFloat(confidence);
  if (Number.isNaN(val) || val >= 0.5 || confidence.includes(':')) return [];
  const name = (getProps(node).name as string) || node.type;
  return [`// TODO(low-confidence): ${name} confidence=${confidence}`];
}
