/**
 * Utility functions for the FastAPI transpiler.
 */

import type { IRNode } from '@kernlang/core';
import { dedent, getFirstChild, getProps } from '@kernlang/core';
import { quoteObjectKeysOutsideStrings } from './core/expr/index.js';
import type { RouteCapabilities, SchemaShape } from './fastapi-types.js';
import { mapTsTypeToPython, toSnakeCase } from './type-map.js';

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'generated'
  );
}

export function escapePyStr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Quote bare identifier keys in JS object literals so they become valid
// Python dict literals: `{userId: x}` → `{"userId": x}`. Scans char-by-char,
// skipping string/template contents, and only quotes an identifier that
// directly follows `{` or `,` AND is followed by `:` — so ternary colons
// (`a ? b : c`), slices, and call args are left untouched.
//
// Shared by the raw `res.json(...)` payload path (fastapi-route.ts) and the
// portable-node expression path (rewriteFastAPIExpr) so both lower object
// literals consistently. Lives here, in the neutral utils module, to avoid
// an import cycle between fastapi-route and fastapi-response/portable.
export { quoteObjectKeysOutsideStrings };

/** Indent handler code by a fixed prefix, preserving internal structure. */
export function indentHandler(code: string, indent: string): string[] {
  const dedented = dedent(code);
  return dedented
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => `${indent}${l}`);
}

export function findServerNode(root: IRNode): IRNode | undefined {
  if (root.type === 'server') return root;
  for (const child of root.children || []) {
    const found = findServerNode(child);
    if (found) return found;
  }
  return undefined;
}

export function convertPath(expressPath: string): string {
  // :id → {id}
  return expressPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

export function derivePathParams(path: string): string[] {
  const matches = path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g);
  return [...matches].map((match) => match[1]);
}

export function analyzeRouteCapabilities(routeNode: IRNode): RouteCapabilities {
  const streamNode = getFirstChild(routeNode, 'stream');
  const spawnNode = streamNode ? getFirstChild(streamNode, 'spawn') : undefined;
  const timerNode = getFirstChild(routeNode, 'timer');

  return {
    hasStream: !!streamNode,
    hasSpawn: !!spawnNode,
    hasTimer: !!timerNode,
    streamNode,
    spawnNode,
    timerNode,
  };
}

export function buildSchema(node?: IRNode): SchemaShape {
  if (!node) return {};
  const props = getProps(node);
  const schema: SchemaShape = {};
  if (typeof props.body === 'string') schema.body = props.body;
  if (typeof props.params === 'string') schema.params = props.params;
  if (typeof props.query === 'string') schema.query = props.query;
  if (typeof props.response === 'string') schema.response = props.response;
  return schema;
}

export function routeFileBase(method: string, path: string, index: number): string {
  const base = slugify(`${method}_${path.replace(/[:/]/g, '_')}`);
  return base === 'generated' ? `route_${index}` : base;
}

// ── Pydantic schema model from inline type ───────────────────────────────

export function buildPydanticModel(name: string, schemaType: string): string[] {
  const lines: string[] = [];
  const trimmed = schemaType.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];

  lines.push(`class ${name}(BaseModel):`);
  const inner = trimmed.slice(1, -1);
  for (const part of inner.split(',')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const rawKey = part.slice(0, colonIdx).trim().replace(/['"?]/g, '');
    const rawType = part.slice(colonIdx + 1).trim();
    const isOptional = part.slice(0, colonIdx).trim().endsWith('?');
    const pyType = mapTsTypeToPython(rawType);
    if (isOptional) {
      lines.push(`    ${toSnakeCase(rawKey)}: ${pyType} | None = None`);
    } else {
      lines.push(`    ${toSnakeCase(rawKey)}: ${pyType}`);
    }
  }
  return lines;
}

// Original (camelCase) field names declared in an inline schema body, e.g.
// `{trackId: string, options?: {stems: boolean}}` → ['trackId', 'options'].
// Parsing mirrors buildPydanticModel exactly (same naive top-level comma
// split) so the returned set matches the fields the generated model
// snake-cases. Callers use it to rewrite `body.<field>` access expressions
// to the model's snake_case attribute names.
export function extractBodyFieldNames(schemaType: string): string[] {
  const trimmed = schemaType.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];
  const inner = trimmed.slice(1, -1);
  const names: string[] = [];
  for (const part of inner.split(',')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const rawKey = part.slice(0, colonIdx).trim().replace(/['"?]/g, '');
    if (rawKey) names.push(rawKey);
  }
  return names;
}
