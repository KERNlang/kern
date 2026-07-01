/**
 * JSON / JSONC analyzer — emits ReviewFindings for parse errors, duplicate
 * keys, and trailing commas in strict JSON. Parallel to python-fallback.ts:
 * a non-ts-morph analysis path that participates in the same finding pipeline
 * so kern-sight (editor diagnostics) and kern-guard (PR Check annotations)
 * both consume it without changes.
 *
 * Dialect detection:
 *   .jsonc                  → JSONC (comments + trailing commas allowed)
 *   tsconfig.json / jsconfig.json / .vscode/*.json → JSONC (de facto)
 *   everything else .json   → strict JSON
 *
 * Fingerprint policy: NOT line-based. Parse errors fingerprint by error code
 * + dialect; duplicate keys fingerprint by key-path. Line numbers shift under
 * unrelated edits — line-based fingerprints would make kern-guard re-post
 * the same finding as "new" on every PR that touched whitespace above it.
 */

import { basename } from 'node:path';
import { type Node, type ParseError, parseTree } from 'jsonc-parser';
import type { ReviewFinding } from '../types.js';

type JsonDialect = 'json' | 'jsonc';

function dialectForPath(filePath: string): JsonDialect {
  if (filePath.endsWith('.jsonc')) return 'jsonc';
  // Files inside a `.vscode/` directory (settings.json, launch.json,
  // tasks.json, extensions.json, …) accept JSONC per VS Code convention.
  // Normalize separators so the check works on Windows paths too.
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/.vscode/')) return 'jsonc';
  // tsconfig + jsconfig allow comments per TS spec — matches `tsconfig.json`,
  // `tsconfig.base.json`, etc. (startsWith already covers `tsconfig.json`.)
  const base = basename(filePath).toLowerCase();
  if (base.startsWith('tsconfig.') || base.startsWith('jsconfig.')) return 'jsonc';
  return 'json';
}

// jsonc-parser ParseErrorCode is a `const enum` — values are inlined at
// compile time and there is no runtime reverse-lookup table. Mirror the
// numeric enum to a stable kebab-case slug here. If jsonc-parser ever
// renumbers (it has been stable since 1.x) the analyzer will degrade to
// `unknown-<n>` rather than crash.
const ERROR_CODE_SLUGS: Record<number, string> = {
  1: 'invalid-symbol',
  2: 'invalid-number-format',
  3: 'property-name-expected',
  4: 'value-expected',
  5: 'colon-expected',
  6: 'comma-expected',
  7: 'close-brace-expected',
  8: 'close-bracket-expected',
  9: 'end-of-file-expected',
  10: 'invalid-comment-token',
  11: 'unexpected-end-of-comment',
  12: 'unexpected-end-of-string',
  13: 'unexpected-end-of-number',
  14: 'invalid-unicode',
  15: 'invalid-escape-character',
  16: 'invalid-character',
};

function errorCodeSlug(code: number): string {
  return ERROR_CODE_SLUGS[code] ?? `unknown-${code}`;
}

function humanize(err: ParseError, dialect: JsonDialect): string {
  const slug = errorCodeSlug(err.error);
  if (slug === 'invalid-comment-token' && dialect === 'json') {
    return 'Comments are not allowed in strict JSON. Rename to .jsonc or remove the comment.';
  }
  if (slug === 'value-expected') return 'Expected a JSON value (string, number, object, array, boolean, or null).';
  if (slug === 'colon-expected') return "Expected ':' between property name and value.";
  if (slug === 'comma-expected') return "Expected ',' between elements.";
  if (slug === 'close-brace-expected') return "Expected '}' to close object.";
  if (slug === 'close-bracket-expected') return "Expected ']' to close array.";
  if (slug === 'invalid-character') return 'Invalid character in JSON.';
  if (slug === 'invalid-escape-character') return 'Invalid escape sequence in string.';
  if (slug === 'invalid-unicode') return 'Invalid Unicode escape sequence.';
  if (slug === 'invalid-number-format') return 'Invalid number format.';
  if (slug === 'property-name-expected') return 'Expected a property name (a quoted string).';
  if (slug === 'end-of-file-expected') return 'Trailing content after end of JSON value.';
  if (slug === 'unexpected-end-of-comment') return 'Unclosed comment — reached end of file before `*/`.';
  if (slug === 'unexpected-end-of-string') return 'Unclosed string — reached end of file before closing quote.';
  if (slug === 'unexpected-end-of-number') return 'Unterminated number literal.';
  if (slug === 'invalid-symbol') return 'Unexpected token in JSON.';
  return `JSON parse error: ${slug}.`;
}

/** Convert a character offset into the source to a 1-based (line, col) pair. */
function offsetToLineCol(source: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (source.charCodeAt(i) === 0x0a /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: clamped - lineStart + 1 };
}

function spanAt(source: string, filePath: string, offset: number, length: number) {
  const start = offsetToLineCol(source, offset);
  const end = offsetToLineCol(source, offset + Math.max(1, length));
  return { file: filePath, startLine: start.line, startCol: start.col, endLine: end.line, endCol: end.col };
}

/**
 * Walk the AST collecting duplicate property names within the same object.
 * Builds a structural key-path (e.g. `compilerOptions.paths`) so the
 * fingerprint stays stable across unrelated formatting changes.
 */
function detectDuplicateKeys(tree: Node, source: string, filePath: string): ReviewFinding[] {
  const out: ReviewFinding[] = [];

  function visit(node: Node, path: string) {
    if (node.type === 'object' && node.children) {
      // Track first-occurrence node AND how many duplicates we've already
      // emitted for that key. The count lets us disambiguate fingerprints
      // when the same key appears 3+ times in one object — without a
      // counter, dedup in kern-guard would collapse all but one into the
      // baseline and a later edit could silently drop a real finding.
      const seen = new Map<string, { firstNode: Node; dupCount: number }>();
      for (const prop of node.children) {
        // jsonc-parser 'property' node: children[0] = key, children[1] = value
        if (prop.type !== 'property' || !prop.children || prop.children.length < 1) continue;
        const keyNode = prop.children[0];
        if (keyNode?.type !== 'string' || typeof keyNode.value !== 'string') continue;
        const key = keyNode.value;
        const childPath = path ? `${path}.${key}` : key;

        const entry = seen.get(key);
        if (entry) {
          entry.dupCount += 1;
          const ruleId = 'json/duplicate-key';
          // Second duplicate keeps the path-only fingerprint (most common
          // case, stable across formatting). Third+ append `#N` so each
          // additional occurrence is independently dedup-able.
          const suffix = entry.dupCount === 1 ? '' : `#${entry.dupCount}`;
          out.push({
            source: 'kern',
            ruleId,
            severity: 'error',
            category: 'bug',
            message: `Duplicate property "${key}" in object. The second value silently overrides the first in JSON.parse.`,
            primarySpan: spanAt(source, filePath, keyNode.offset, keyNode.length),
            relatedSpans: [spanAt(source, filePath, entry.firstNode.offset, entry.firstNode.length)],
            confidence: 100,
            fingerprint: `${ruleId}:${childPath}${suffix}`,
          });
        } else {
          seen.set(key, { firstNode: keyNode, dupCount: 0 });
        }

        const valueNode = prop.children[1];
        if (valueNode) visit(valueNode, childPath);
      }
    } else if (node.type === 'array' && node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child) visit(child, `${path}[${i}]`);
      }
    }
  }

  visit(tree, '');
  return out;
}

/** Entry point for the engine dispatcher. */
export function reviewJsonFile(source: string, filePath: string): ReviewFinding[] {
  const dialect = dialectForPath(filePath);
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, {
    disallowComments: dialect === 'json',
    allowTrailingComma: dialect === 'jsonc',
  });

  const findings: ReviewFinding[] = [];

  // Track per-(ruleId) occurrence count so multiple parse errors of the
  // same kind (e.g. two separate `invalid-comment-token` in a strict JSON)
  // produce distinct fingerprints. Without this, kern-guard's baseline
  // dedup collapses N independent errors into one and silently hides the
  // others on the next PR.
  const perRuleCount = new Map<string, number>();
  for (const err of errors) {
    const slug = errorCodeSlug(err.error);
    const ruleId = `json/parse/${slug}`;
    const idx = perRuleCount.get(ruleId) ?? 0;
    perRuleCount.set(ruleId, idx + 1);
    // First occurrence keeps the cleanest fingerprint (most common case
    // is exactly one parse error per file); 2nd+ append `#N` so they are
    // independently dedup-able. Still line-independent.
    const suffix = idx === 0 ? '' : `#${idx}`;
    findings.push({
      source: 'kern',
      ruleId,
      severity: 'error',
      category: 'bug',
      message: humanize(err, dialect),
      primarySpan: spanAt(source, filePath, err.offset, err.length),
      confidence: 100,
      fingerprint: `${ruleId}:${dialect}${suffix}`,
    });
  }

  if (tree) {
    findings.push(...detectDuplicateKeys(tree, source, filePath));
  }

  return findings;
}
