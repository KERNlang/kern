/**
 * file-too-monolithic — warns when a .kern file accumulates many top-level
 * concern declarations outside any `module Name { … }` grouping.
 *
 * Why this rule exists:
 *   KERN's value proposition is *structured* code — the declarative layer
 *   separates orchestration from imperative bodies. A file with 15+ loose
 *   top-level handlers/fns/routes erodes that separation: navigating the
 *   file requires the same scan as a 500-line .ts file would, defeating the
 *   structural-greppability win. First-class `module Name { … }` syntax
 *   gives authors a no-code-move way to restore that structure — group
 *   related declarations into named modules inside the same file.
 *
 *   Real-world trigger: AGON-AI's brain.kern hit ~800 lines as a single
 *   ungrouped wall of declarations; the file became "TypeScript wearing a
 *   KERN coat." This rule nudges authors toward either splitting the file
 *   or wrapping concerns in module blocks before that rot sets in.
 *
 * Behavior:
 *   - Count root-level declarations of "concern" types (fn, screen, route,
 *     handler, service, machine, singleton, surface, provider, hook).
 *   - Declarations *inside* a top-level `module` block do NOT count — the
 *     module wrapper is the blessed remediation, so authors who already
 *     used it are not punished for having many modules in one file.
 *   - Default threshold N = 12. Drops to 10 if ≥3 handlers anywhere in the
 *     file exceed handler-size (>30 non-comment lines).
 *   - Floor: files with fewer than 3 ungrouped concerns are exempt — a
 *     four-helper utility file is not a monolith.
 *
 * Carve-outs (rule skipped entirely):
 *   - Test/fixture files: *.test.kern, *.spec.kern, *.fixture.kern
 *   - Paths containing /tests/, /__tests__/, /fixtures/, /__fixtures__/,
 *     /__generated__/, /generated/
 *   - Barrel-style entrypoints: index.kern, barrel.kern, _entry.kern
 *
 * Layer: kern-source, severity: warning, precision: medium, ciDefault: guarded.
 */

import type { IRNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import type { KernSourceRule } from './kern-source.js';
import { finding } from './utils.js';

const CONCERN_TYPES = new Set([
  'fn',
  'screen',
  'route',
  'handler',
  'service',
  'machine',
  'singleton',
  'surface',
  'provider',
  'hook',
]);

const DEFAULT_THRESHOLD = 12;
const ESCALATED_THRESHOLD = 10;
const FLOOR = 3;
const HANDLER_LINE_LIMIT = 30;
const ESCALATION_TRIGGER = 3;

const SKIP_FILE_BASENAMES = new Set(['index.kern', 'barrel.kern', '_entry.kern']);
const SKIP_PATH_SEGMENTS = new Set(['tests', '__tests__', 'fixtures', '__fixtures__', '__generated__', 'generated']);
const SKIP_BASENAME_PATTERN = /\.(test|spec|fixture|generated|gen)\.kern$/;

function isSkippedFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const basename = segments[segments.length - 1] ?? normalized;
  if (SKIP_FILE_BASENAMES.has(basename)) return true;
  if (SKIP_BASENAME_PATTERN.test(basename)) return true;
  for (const segment of segments) {
    if (SKIP_PATH_SEGMENTS.has(segment)) return true;
  }
  return false;
}

function countOversizedHandlers(nodes: IRNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type !== 'handler') continue;
    const code = typeof node.props?.code === 'string' ? (node.props.code as string) : '';
    if (!code) continue;
    let lines = 0;
    for (const raw of code.split('\n')) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
      lines++;
    }
    if (lines > HANDLER_LINE_LIMIT) count++;
  }
  return count;
}

/**
 * `nodes` is the fully flattened IR (every node at every depth). In non-document
 * parse mode (used by `reviewKernSource`), subsequent top-level declarations are
 * nested as children of the first declaration in the tree — so we can't infer
 * file-root membership from parent/child relationships.
 *
 * File-root signals:
 *   - `loc.col === 1` — unprefixed declarations start at the left margin.
 *   - `props.export === true` — `export fn`/`export screen`/etc. have their
 *     keyword token at col 8 (after the `export ` prefix), so the col check
 *     alone misses them. The export prop is the reliable cross-check.
 *
 * Either signal qualifies a node as a true file-level declaration regardless
 * of where the parser placed it in the IR tree.
 */
function findFileRoots(nodes: IRNode[]): IRNode[] {
  return nodes.filter((n) => (n.loc?.col ?? 0) === 1 || n.props?.export === true);
}

export const fileTooMonolithic: KernSourceRule = (nodes: IRNode[], filePath: string): ReviewFinding[] => {
  if (isSkippedFile(filePath)) return [];

  const roots = findFileRoots(nodes);
  let ungroupedCount = 0;
  let firstConcern: IRNode | undefined;
  const typeTally: Record<string, number> = {};
  let moduleCount = 0;

  for (const node of roots) {
    if (node.type === 'module') {
      moduleCount++;
      continue;
    }
    if (CONCERN_TYPES.has(node.type)) {
      ungroupedCount++;
      typeTally[node.type] = (typeTally[node.type] ?? 0) + 1;
      if (!firstConcern) firstConcern = node;
    }
  }

  if (ungroupedCount < FLOOR) return [];

  const oversizedHandlers = countOversizedHandlers(nodes);
  const escalated = oversizedHandlers >= ESCALATION_TRIGGER;
  const threshold = escalated ? ESCALATED_THRESHOLD : DEFAULT_THRESHOLD;

  if (ungroupedCount <= threshold) return [];

  const breakdown = Object.entries(typeTally)
    .sort(([, a], [, b]) => b - a)
    .map(([t, n]) => `${n} ${t}${n === 1 ? '' : 's'}`)
    .join(', ');

  const escalationNote = escalated
    ? ` Threshold tightened to ${threshold} because ${oversizedHandlers} handlers in this file exceed the ${HANDLER_LINE_LIMIT}-line handler-size limit.`
    : '';

  const message =
    `.kern file has ${ungroupedCount} top-level concern declarations outside any \`module\` block ` +
    `(${breakdown}); limit is ${threshold}.${escalationNote} ` +
    'Group related declarations under `module Name` blocks or split into separate files to keep the structural layer scannable.';

  const suggestion =
    moduleCount === 0
      ? `Wrap related declarations in \`module Name\` blocks — declarations inside modules don't count toward this limit. Example: \`module name=domain\` followed by indented \`fn\`/\`route\`/\`handler\` children.`
      : `This file already uses ${moduleCount} module block${moduleCount === 1 ? '' : 's'}; move the remaining ${ungroupedCount} ungrouped declarations into existing or new modules, or split them into a sibling .kern file.`;

  const line = firstConcern?.loc?.line ?? 1;
  const col = firstConcern?.loc?.col ?? 1;

  return [
    finding('file-too-monolithic', 'warning', 'structure', message, filePath, line, col, {
      suggestion,
    }),
  ];
};
