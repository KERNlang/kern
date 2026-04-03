/**
 * Utility functions for the FastAPI transpiler.
 */

import type { IRNode } from '@kernlang/core';
import { dedent, getChildren, getFirstChild, getProps } from '@kernlang/core';
import { mapTsTypeToPython, toSnakeCase } from './type-map.js';
import type { SchemaShape, RouteCapabilities } from './fastapi-types.js';

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'generated';
}

export function escapePyStr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Indent handler code by a fixed prefix, preserving internal structure. */
export function indentHandler(code: string, indent: string): string[] {
  const dedented = dedent(code);
  return dedented.split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => `${indent}${l}`);
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
  return [...matches].map(match => match[1]);
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
