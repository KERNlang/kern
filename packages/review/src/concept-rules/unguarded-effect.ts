/**
 * Rule: unguarded-effect
 *
 * Fires when a network/db effect has no auth/validation guard in the same container.
 * Works on any language that emits effect + guard concepts.
 *
 * TS: fetch() in a route handler without auth/validation
 * Python: requests.get() in a view without auth/validation
 * Go: db.Query() in a handler without auth/validation
 */

import type { ConceptMap } from '@kernlang/core';
import { createPathCanonicalizer } from '../path-canonical.js';
import type { ReviewFinding } from '../types.js';
import { createFingerprint } from '../types.js';
import type { ConceptRuleContext } from './index.js';

const GUARD_SUBTYPES = new Set(['auth', 'validation']);
// Files in apps/<x>/worker/ or any /jobs/ segment are queue-driven workers,
// not HTTP handlers. The "guard" lives at the queue boundary (queue auth +
// the upstream API webhook validation), neither expressible as an in-process
// auth call. Forcing in-process guards here is a category error.
// Matches both `apps/<x>/worker/<...>` (worker package) and `apps/<x>/worker.ts`
// (single-file worker), plus any path containing a `/jobs/` segment. The
// trailing `.` covers worker.ts/worker.js/worker.mjs without committing to a
// specific extension.
const WORKER_PATH_RE = /(?:^|\/)apps\/[^/]+\/worker(?:\/|\.|$)|\/jobs\//;
const UI_IMPORT_RE = /^(react|react-dom|next)(\/|$)/;

function fileHasImport(concepts: ConceptMap, predicate: (specifier: string) => boolean): boolean {
  for (const edge of concepts.edges) {
    const payload = edge.payload as { kind?: string; specifier?: string } | undefined;
    if (payload?.kind !== 'dependency') continue;
    if (payload.specifier && predicate(payload.specifier)) return true;
  }
  return false;
}

/**
 * True when the file is a pure worker/jobs file with no HTTP or UI shape.
 * Such files are exempted from the rule entirely (see header comment).
 *
 * The check is strictly file-level: a file that is in a worker path AND
 * also exports a route handler still has guards required on the route
 * handler — the file-level exemption is too coarse in that case, so we
 * fall back to normal rule evaluation.
 *
 * Exported because the parallel `unguarded-effect.kern` native rule does
 * not see this filter; index.ts re-applies it post-collection so both
 * rule sources respect the exemption.
 */
export function isWorkerContextFile(filePath: string, concepts: ConceptMap): boolean {
  if (!WORKER_PATH_RE.test(filePath)) return false;
  if (fileHasImport(concepts, (s) => UI_IMPORT_RE.test(s))) return false;
  // Mixed file: a worker that also exports a route handler. Don't apply
  // the file-level exemption — let the rule fire on the route handler.
  for (const node of concepts.nodes) {
    if (node.kind !== 'entrypoint') continue;
    if (node.payload.kind !== 'entrypoint') continue;
    if (node.payload.subtype === 'route') return false;
  }
  return true;
}

export function unguardedEffect(ctx: ConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // File-level worker/jobs exemption — see isWorkerContextFile.
  if (isWorkerContextFile(ctx.filePath, ctx.concepts)) return findings;

  // Build a set of containerIds that have auth/validation guards (same file)
  const guardedContainers = new Set<string>();
  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'guard') continue;
    if (node.payload.kind !== 'guard') continue;
    if (!GUARD_SUBTYPES.has(node.payload.subtype)) continue;
    if (node.containerId) {
      guardedContainers.add(node.containerId);
    }
  }

  // Cross-file: a guard counts when it sits on the call chain that reaches
  // this effect. Two patterns:
  //   (A) Caller-of-caller guard:  page.tsx → actions.ts (guard) → lib/foo.ts (effect)
  //       Walk INCOMING (importers) up to 2 hops.
  //   (B) Direct dependency guard: handler.ts (effect) → middleware.ts (guard)
  //       Walk OUTGOING (importees) up to 1 hop — the existing pre-2-hop behavior.
  //
  // Crucially we do NOT mix directions in a single walk. Doing so makes
  // shared dependencies imply guard relationships: any other file that
  // imports the same helper (e.g. db.ts) and happens to have its own
  // guard would silently vouch for an unrelated unguarded effect here.
  //
  // graphImports values are already canonical (resolved through realpath at
  // graph build time) but its keys, allConcepts keys, and ctx.filePath are
  // the caller-supplied paths. On macOS those diverge via /var → /private/var,
  // and pnpm monorepos diverge through node_modules/.pnpm symlinks. We
  // canonicalize on both sides so the BFS sees one consistent identifier
  // space — see path-canonical.ts and red-team #9.
  let hasCrossFileGuard = false;
  if (ctx.allConcepts && ctx.graphImports) {
    const canon = createPathCanonicalizer();

    const canonImports = new Map<string, string[]>();
    for (const [from, imports] of ctx.graphImports) {
      canonImports.set(
        canon(from),
        imports.map((i) => canon(i)),
      );
    }
    // Reverse-importers index: for each canonical file, the canonical files
    // that import it. Built once so the incoming-edge lookup in the BFS is
    // O(1) per node visited rather than O(graph) — matters on large monorepos.
    const canonImporters = new Map<string, string[]>();
    for (const [from, imports] of canonImports) {
      for (const imp of imports) {
        const list = canonImporters.get(imp);
        if (list) list.push(from);
        else canonImporters.set(imp, [from]);
      }
    }
    const canonConcepts = new Map<string, ConceptMap>();
    for (const [path, cm] of ctx.allConcepts) {
      canonConcepts.set(canon(path), cm);
    }

    const startCanon = canon(ctx.filePath);

    const fileHasGuard = (file: string): boolean => {
      const concepts = canonConcepts.get(file);
      if (!concepts) return false;
      for (const node of concepts.nodes) {
        if (node.kind !== 'guard') continue;
        if (node.payload.kind !== 'guard') continue;
        if (!GUARD_SUBTYPES.has(node.payload.subtype)) continue;
        return true;
      }
      return false;
    };

    // Single-direction BFS. neighbors() returns either importers (incoming
    // walk) or importees (outgoing walk) depending on which graph we pass.
    const walk = (graph: Map<string, string[]>, maxHops: number): boolean => {
      const visited = new Set<string>([startCanon]);
      let frontier: string[] = [startCanon];
      for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
        const next: string[] = [];
        for (const file of frontier) {
          const neighbors = graph.get(file);
          if (!neighbors) continue;
          for (const n of neighbors) {
            if (visited.has(n)) continue;
            visited.add(n);
            if (fileHasGuard(n)) return true;
            next.push(n);
          }
        }
        frontier = next;
      }
      return false;
    };

    // (A) Up to 2 hops of importers (callers and callers-of-callers).
    if (walk(canonImporters, 2)) hasCrossFileGuard = true;
    // (B) 1 hop of importees (direct dependencies, e.g. middleware modules).
    else if (walk(canonImports, 1)) hasCrossFileGuard = true;
  }

  // Find network/db effects without a guard in the same container
  for (const node of ctx.concepts.nodes) {
    if (node.kind !== 'effect') continue;
    if (node.payload.kind !== 'effect') continue;

    const { subtype } = node.payload;
    if (subtype !== 'network' && subtype !== 'db') continue;

    // Skip if guarded in same file
    if (node.containerId && guardedContainers.has(node.containerId)) continue;

    // Skip if a related file (≤2 hops) has guards (cross-file guard)
    if (hasCrossFileGuard) continue;

    findings.push({
      source: 'kern',
      ruleId: 'unguarded-effect',
      severity: 'warning',
      category: 'bug',
      message: `Network/DB effect without auth/validation guard`,
      primarySpan: {
        file: node.primarySpan.file,
        startLine: node.primarySpan.startLine,
        startCol: node.primarySpan.startCol,
        endLine: node.primarySpan.endLine,
        endCol: node.primarySpan.endCol,
      },
      fingerprint: createFingerprint('unguarded-effect', node.primarySpan.startLine, node.primarySpan.startCol),
      confidence: node.confidence,
    });
  }

  return findings;
}
