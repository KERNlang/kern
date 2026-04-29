/**
 * Codegen helpers — shared micro-utilities and annotation emitters
 * used across all Python code generators.
 */

import type { ExprObject, IRNode } from '@kernlang/core';
import { mapTsTypeToPython, toSnakeCase } from './type-map.js';

// ── Micro-helpers ──────────────────────────────────────────────────────

export function p(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

export function kids(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter((n) => n.type === type) : c;
}

export function firstChild(node: IRNode, type: string): IRNode | undefined {
  return kids(node, type)[0];
}

// ── Reason & Confidence Annotations (Python) ────────────────────────────

export function emitPyReasonAnnotations(node: IRNode): string[] {
  const reasonNode = firstChild(node, 'reason');
  const evidenceNode = firstChild(node, 'evidence');
  const needsNodes = kids(node, 'needs');
  const confidence = p(node).confidence as string | undefined;

  if (!reasonNode && !evidenceNode && !confidence && needsNodes.length === 0) return [];

  const lines: string[] = [];
  if (confidence) lines.push(`# @confidence ${confidence}`);
  if (reasonNode) {
    const rp = p(reasonNode);
    lines.push(`# @reason ${rp.because || ''}`);
    if (rp.basis) lines.push(`# @basis ${rp.basis}`);
    if (rp.survives) lines.push(`# @survives ${rp.survives}`);
  }
  if (evidenceNode) {
    const ep = p(evidenceNode);
    const parts = [`source=${ep.source}`];
    if (ep.method) parts.push(`method=${ep.method}`);
    if (ep.authority) parts.push(`authority=${ep.authority}`);
    lines.push(`# @evidence ${parts.join(', ')}`);
  }
  for (const needsNode of needsNodes) {
    const np = p(needsNode);
    const desc = (np.what as string) || (np.description as string) || '';
    const wouldRaise = np['would-raise-to'] as string;
    const tag = wouldRaise ? `${desc} (would raise to ${wouldRaise})` : desc;
    lines.push(`# @needs ${tag}`);
  }
  return lines;
}

/** Emit a TODO comment for nodes with low literal confidence (< 0.5). */
export function emitPyLowConfidenceTodo(node: IRNode, confidence: string | undefined): string[] {
  if (!confidence) return [];
  const val = parseFloat(confidence);
  if (Number.isNaN(val) || val >= 0.5 || confidence.includes(':')) return [];
  const name = (p(node).name as string) || node.type;
  return [`# TODO(low-confidence): ${name} confidence=${confidence}`];
}

// ── Target-neutral param-list builder (Python side) ────────────────────────
//
// Slice 3c P2 follow-up — supersedes the four ad-hoc `params.split(',')`
// parsers that used to live in core.ts / ground.ts / data.ts. Reads
// structured `param` children when present (slice 3c+ canonical form)
// and falls back to the legacy `params="..."` string for back-compat with
// pre-slice-3c sources.
//
// Returns the joined parameter signature for a Python `def` line:
//   "name: int, retries: int = 3, *args: str, opt: Optional[str] = None"
//
// Param features supported per child:
//   - `name=` + `type=`  → `name: T`
//   - `value=` (slice 3c ValueIR) / `default=` (rawExpr) → `name: T = expr`
//     `value` wins when both are set (matches core's parseParamListFromChildren).
//     ExprObject `{{...}}` emits its `.code` raw; bare values emit as-is.
//   - `optional=true` (slice 3c-extension) → wraps type in `Optional[T]` and
//     defaults to `= None` when no value/default is present.
//   - `variadic=true` (slice 3c-extension) → prepends `*` to the name and
//     strips a trailing `[]` from the type so `string[]` becomes `str`,
//     matching Python's element-typed `*args: T` convention.
//   - `binding`/`element` children (slice 3c-extension #3 destructure) →
//     skipped entirely in the Python signature. Python has no equivalent
//     to TS destructured params; callers wanting to unpack should do it
//     in the function body.
//
// `selfPrefix=true` prepends `self` for method signatures.
function isExprObject(value: unknown): value is ExprObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __expr?: unknown }).__expr === true &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

function formatPyDefault(paramNode: IRNode): string {
  const props = p(paramNode);
  const rawValue = props.value;
  const rawDefault = props.default;
  // Slice 3c: bare empty `value=` is treated as absent so `parseExpression('')`
  // never fires (mirrors core's parseParamListFromChildren gate).
  const valuePresent =
    rawValue !== undefined && (rawValue !== '' || paramNode.__quotedProps?.includes('value') === true);
  if (valuePresent) {
    if (isExprObject(rawValue)) return rawValue.code;
    const isQuoted = paramNode.__quotedProps?.includes('value') === true;
    return isQuoted ? JSON.stringify(rawValue) : String(rawValue);
  }
  if (rawDefault !== undefined && rawDefault !== '') {
    if (isExprObject(rawDefault)) return rawDefault.code;
    return String(rawDefault);
  }
  return '';
}

function formatPyParamFromChild(paramNode: IRNode): string | null {
  const props = p(paramNode);
  const hasDestructure = (paramNode.children ?? []).some((c) => c.type === 'binding' || c.type === 'element');
  // Python has no destructured-param syntax — skip entirely.
  if (hasDestructure) return null;

  const rawName = (props.name as string) || 'arg';
  const variadic = props.variadic === true || props.variadic === 'true';
  const optional = props.optional === true || props.optional === 'true';
  const rawType = props.type as string | undefined;

  // Variadic: `*args: T` (element type, not the array). Strip a trailing `[]`
  // before mapping so `string[]` → `str`.
  const typeBase = variadic && rawType?.endsWith('[]') ? rawType.slice(0, -2) : rawType;
  const pyName = toSnakeCase(rawName);
  const namePart = variadic ? `*${pyName}` : pyName;
  const defaultStr = formatPyDefault(paramNode);

  if (optional && !defaultStr) {
    // `name: Optional[T] = None` (or `name = None` when type is missing).
    const optType = typeBase ? `: Optional[${mapTsTypeToPython(typeBase)}]` : '';
    return `${namePart}${optType} = None`;
  }

  const typePart = typeBase ? `: ${mapTsTypeToPython(typeBase)}` : '';
  return defaultStr ? `${namePart}${typePart} = ${defaultStr}` : `${namePart}${typePart}`;
}

export function buildPythonParamList(node: IRNode, options?: { selfPrefix?: boolean }): string {
  const paramChildren = kids(node, 'param');
  let signature: string;

  if (paramChildren.length > 0) {
    signature = paramChildren
      .map((paramNode) => formatPyParamFromChild(paramNode))
      .filter((s): s is string => s !== null && s !== '')
      .join(', ');
  } else {
    // Legacy `params="..."` string fallback.
    const rawParams = (p(node).params as string) || '';
    if (!rawParams) signature = '';
    else
      signature = rawParams
        .split(',')
        .map((part) => {
          const [pname, ...ptype] = part
            .trim()
            .split(':')
            .map((t) => t.trim());
          const ptypeStr = ptype.join(':');
          return ptypeStr ? `${toSnakeCase(pname)}: ${mapTsTypeToPython(ptypeStr)}` : toSnakeCase(pname);
        })
        .join(', ');
  }

  if (!options?.selfPrefix) return signature;
  return signature ? `self, ${signature}` : 'self';
}
