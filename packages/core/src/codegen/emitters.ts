/**
 * Safe Emitters — prompt-injection immunity for KERN codegen.
 *
 * Every prop value interpolated into generated code MUST go through one of these.
 * Raw string splicing is the root cause of codegen injection (audit 2026-03-25).
 *
 * Extracted from codegen-core.ts for independent reuse by React/Vue/Python codegens.
 */

import type { IRNode } from '../types.js';
import { KernCodegenError } from '../errors.js';

// Matches valid JS/TS identifiers — KERN hyphens are converted to camelCase by the parser.
const SAFE_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const SAFE_PATH_RE = /^[A-Za-z0-9/_.\-~]+$/;
const SAFE_IMPORT_RE = /^(@[A-Za-z0-9_-]+\/)?[A-Za-z0-9_./:~-]+$/;

/** Validate and emit a safe identifier for generated code. Throws on invalid. */
export function emitIdentifier(value: string | undefined, fallback: string, node?: IRNode): string {
  const v = value || fallback;
  if (!SAFE_IDENT_RE.test(v)) {
    throw new KernCodegenError(`Invalid identifier: '${v.slice(0, 50)}' — must match KERN identifier grammar [A-Za-z_$][A-Za-z0-9_$]*`, node);
  }
  return v;
}

/** Escape a string for safe interpolation into a single-quoted JS string literal. */
export function emitStringLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `'${escaped}'`;
}

/** Validate and emit a safe filesystem path for generated code. */
export function emitPath(value: string, node?: IRNode): string {
  if (!SAFE_PATH_RE.test(value)) {
    throw new KernCodegenError(`Invalid path: '${value.slice(0, 80)}' — contains unsafe characters`, node);
  }
  if (value.includes('..')) {
    throw new KernCodegenError(`Invalid path: '${value.slice(0, 80)}' — path traversal (..) not allowed`, node);
  }
  return emitStringLiteral(value);
}

/** Escape a value for interpolation into a template literal in generated code. */
export function emitTemplateSafe(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

/**
 * Validate and emit a safe TypeScript type annotation for generated code.
 * Handles generics, arrays, unions, intersections, tuples, function types.
 * Rejects semicolons, backticks, template literals, dynamic imports, comments.
 */
export function emitTypeAnnotation(value: string | undefined, fallback: string, node?: IRNode): string {
  const v = (value || fallback).trim();
  if (!v) return fallback;

  if (v.includes('`'))
    throw new KernCodegenError(`Invalid type annotation: '${v.slice(0, 80)}' — backticks not allowed in types`, node);
  if (v.includes('${'))
    throw new KernCodegenError(`Invalid type annotation: '${v.slice(0, 80)}' — template interpolation not allowed`, node);
  // Semicolons are valid inside object types { x: string; y: number } but not at top level
  // Top-level semicolons checked during bracket scanning below
  if (/import\s*\(/.test(v))
    throw new KernCodegenError(`Invalid type annotation: '${v.slice(0, 80)}' — dynamic imports not allowed in types`, node);
  if (v.includes('//') || v.includes('/*'))
    throw new KernCodegenError(`Invalid type annotation: '${v.slice(0, 80)}' — comments not allowed in types`, node);

  const stack: string[] = [];
  const pairs: Record<string, string> = { '<': '>', '(': ')', '[': ']', '{': '}' };
  const closers: Record<string, string> = { '>': '<', ')': '(', ']': '[', '}': '{' };
  let inString: string | null = null;

  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if ((ch === "'" || ch === '"') && (i === 0 || v[i - 1] !== '\\')) {
      if (inString === ch) { inString = null; } else if (!inString) { inString = ch; }
      continue;
    }
    if (inString) continue;
    // Reject semicolons at top level (statement injection) but allow inside {} (object types)
    if (ch === ';' && stack.length === 0) {
      throw new KernCodegenError(`Invalid type annotation: '${v.slice(0, 80)}' — semicolons not allowed at top level in types`, node);
    }
    if (ch === '>' && i > 0 && v[i - 1] === '=') continue;
    if (ch in pairs) {
      stack.push(ch);
    } else if (ch in closers) {
      const expected = closers[ch];
      if (stack.length === 0 || stack[stack.length - 1] !== expected) {
        throw new KernCodegenError(`Invalid type annotation: '${v.slice(0, 80)}' — unbalanced '${ch}'`, node);
      }
      stack.pop();
    }
  }

  if (inString) throw new KernCodegenError(`Invalid type annotation: '${v.slice(0, 80)}' — unclosed string literal`, node);
  if (stack.length > 0) throw new KernCodegenError(`Invalid type annotation: '${v.slice(0, 80)}' — unclosed '${stack[stack.length - 1]}'`, node);

  return v;
}

/** Validate and emit a safe import specifier for generated code. */
export function emitImportSpecifier(value: string, node?: IRNode): string {
  if (!value) throw new KernCodegenError('Import specifier cannot be empty', node);
  if (value.includes("'") || value.includes('"') || value.includes('`') || value.includes('\\')) {
    throw new KernCodegenError(`Invalid import specifier: '${value.slice(0, 80)}' — contains quote or escape characters`, node);
  }
  if (value.includes(';') || value.includes('$') || value.includes('\n')) {
    throw new KernCodegenError(`Invalid import specifier: '${value.slice(0, 80)}' — contains unsafe characters`, node);
  }
  if (!SAFE_IMPORT_RE.test(value)) {
    throw new KernCodegenError(`Invalid import specifier: '${value.slice(0, 80)}' — must be a valid module path`, node);
  }
  return value;
}
