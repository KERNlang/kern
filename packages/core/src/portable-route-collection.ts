import type { IRNode } from './types.js';

export function parsePortablePathSegments(raw: string, node: IRNode, propName: string): string[] {
  const path = raw.trim();
  if (!path) throw new Error(`portable route \`${node.type}\` requires a non-empty \`${propName}\` path.`);
  const segments = path.split('.');
  for (const segment of segments) {
    if (!segment) throw new Error(`portable route \`${node.type}\` ${propName}= cannot contain empty path segments.`);
    if (!/^(?:[A-Za-z_$][\w$]*|0|[1-9]\d*)$/.test(segment)) {
      throw new Error(`portable route \`${node.type}\` ${propName}= contains unsupported path segment \`${segment}\`.`);
    }
  }
  return segments;
}

export function parsePortableNonNegativeIntLiteral(raw: string, node: IRNode, propName: string): string {
  const value = raw.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`portable route \`${node.type}\` ${propName}= must be a non-negative integer literal.`);
  }
  return value;
}
