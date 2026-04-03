/**
 * Semantic Diff — detects behavior changes between old and new versions of code.
 *
 * Compares IR (InferResult[]) and concept maps (ConceptMap) between git versions
 * to detect guard removals, error handling changes, new effects, param changes, etc.
 *
 * Used in `kern review --diff <base>` to augment line-level diffs with
 * semantic understanding of WHAT changed.
 */

import { execFileSync } from 'child_process';
import type { ConceptMap, ConceptNode, ConceptNodeKind } from '@kernlang/core';
import type { InferResult } from './types.js';
import { inferFromSource, createInMemoryProject } from './inferrer.js';
import { extractTsConcepts } from './mappers/ts-concepts.js';

// ── Public Types ────────────────────────────────────────────────────────

export type SemanticChangeType =
  | 'guard-removed'
  | 'guard-added'
  | 'error-handling-removed'
  | 'error-handling-added'
  | 'effect-added'
  | 'effect-removed'
  | 'return-type-changed'
  | 'new-code-path'
  | 'param-changed';

export interface SemanticChange {
  type: SemanticChangeType;
  severity: 'error' | 'warning' | 'info';
  functionName: string;
  filePath: string;
  line: number;
  description: string;
  oldValue?: string;
  newValue?: string;
}

// ── Git Helpers ─────────────────────────────────────────────────────────

/**
 * Get the old version of a file from git.
 * Returns null for new files (no old version exists).
 */
export function getOldFileContent(filePath: string, baseRef: string): string | null {
  try {
    return execFileSync('git', ['show', `${baseRef}:${filePath}`], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return null; // New file — no old version
  }
}

// ── Function Matching ───────────────────────────────────────────────────

/** Extract function name from an InferResult node. */
function getFnName(result: InferResult): string | undefined {
  if (result.node.type !== 'fn') return undefined;
  return result.node.props?.name as string | undefined;
}

/** Get functions from InferResult[], keyed by name. */
function buildFnMap(inferred: InferResult[]): Map<string, InferResult> {
  const map = new Map<string, InferResult>();
  for (const r of inferred) {
    const name = getFnName(r);
    if (name) map.set(name, r);
  }
  return map;
}

// ── Concept Grouping ────────────────────────────────────────────────────

/**
 * Group concept nodes by their container function.
 * The containerId format is `${filePath}#fn:${name}@${offset}` — we extract the function name.
 */
function groupConceptsByFunction(
  concepts: ConceptMap | undefined,
): Map<string, ConceptNode[]> {
  const groups = new Map<string, ConceptNode[]>();
  if (!concepts) return groups;

  for (const node of concepts.nodes) {
    const containerId = node.containerId;
    if (!containerId) continue;

    // Extract function name from containerId: path#fn:name@offset
    const fnMatch = containerId.match(/#fn:(.+)@\d+$/);
    const fnName = fnMatch ? fnMatch[1] : containerId;

    if (!groups.has(fnName)) groups.set(fnName, []);
    groups.get(fnName)!.push(node);
  }

  return groups;
}

/** Filter concept nodes by kind. */
function filterByKind(nodes: ConceptNode[], kind: ConceptNodeKind): ConceptNode[] {
  return nodes.filter(n => n.kind === kind);
}

/** Summarize a concept node for display. */
function summarizeConcept(node: ConceptNode): string {
  const evidence = node.evidence.substring(0, 80);
  return evidence.replace(/\n/g, ' ').trim();
}

// ── Core Diff Engine ────────────────────────────────────────────────────

/**
 * Compute semantic differences between old and new versions of a file.
 *
 * Compares:
 * - Functions (InferResult[]) for parameter and return type changes
 * - Concepts (ConceptMap) for guard, error handling, and effect changes
 * - New functions in the new version
 */
export function computeSemanticDiff(
  oldInferred: InferResult[],
  newInferred: InferResult[],
  oldConcepts: ConceptMap | undefined,
  newConcepts: ConceptMap | undefined,
  filePath: string,
): SemanticChange[] {
  const changes: SemanticChange[] = [];

  const oldFns = buildFnMap(oldInferred);
  const newFns = buildFnMap(newInferred);

  const oldConceptsByFn = groupConceptsByFunction(oldConcepts);
  const newConceptsByFn = groupConceptsByFunction(newConcepts);

  // ── Compare matched functions ────────────────────────────────────────
  for (const [fnName, newFn] of newFns) {
    const oldFn = oldFns.get(fnName);

    if (!oldFn) {
      // New function — report as new code path
      changes.push({
        type: 'new-code-path',
        severity: 'info',
        functionName: fnName,
        filePath,
        line: newFn.startLine,
        description: `New function: ${fnName}`,
        newValue: newFn.summary,
      });
      continue;
    }

    // Compare parameters
    const oldParams = (oldFn.node.props?.params as string) || '';
    const newParams = (newFn.node.props?.params as string) || '';
    if (oldParams !== newParams) {
      changes.push({
        type: 'param-changed',
        severity: 'info',
        functionName: fnName,
        filePath,
        line: newFn.startLine,
        description: `Parameters changed in ${fnName}`,
        oldValue: oldParams || '(none)',
        newValue: newParams || '(none)',
      });
    }

    // Compare return types
    const oldReturns = (oldFn.node.props?.returns as string) || '';
    const newReturns = (newFn.node.props?.returns as string) || '';
    if (oldReturns !== newReturns && oldReturns !== '' && newReturns !== '') {
      changes.push({
        type: 'return-type-changed',
        severity: 'warning',
        functionName: fnName,
        filePath,
        line: newFn.startLine,
        description: `Return type changed in ${fnName}: ${oldReturns} → ${newReturns}`,
        oldValue: oldReturns,
        newValue: newReturns,
      });
    }

    // Compare concepts within this function
    const oldFnConcepts = oldConceptsByFn.get(fnName) || [];
    const newFnConcepts = newConceptsByFn.get(fnName) || [];

    // ── Guards ──────────────────────────────────────────────────────────
    const oldGuards = filterByKind(oldFnConcepts, 'guard');
    const newGuards = filterByKind(newFnConcepts, 'guard');

    if (oldGuards.length > 0 && newGuards.length === 0) {
      const guardDescriptions = oldGuards.map(g => summarizeConcept(g)).join('; ');
      changes.push({
        type: 'guard-removed',
        severity: 'error',
        functionName: fnName,
        filePath,
        line: newFn.startLine,
        description: `Validation guard removed from ${fnName}`,
        oldValue: guardDescriptions,
      });
    } else if (oldGuards.length === 0 && newGuards.length > 0) {
      const guardDescriptions = newGuards.map(g => summarizeConcept(g)).join('; ');
      changes.push({
        type: 'guard-added',
        severity: 'info',
        functionName: fnName,
        filePath,
        line: newFn.startLine,
        description: `Validation guard added to ${fnName}`,
        newValue: guardDescriptions,
      });
    } else if (oldGuards.length > newGuards.length) {
      // Some guards removed — partial removal is still concerning
      const removedCount = oldGuards.length - newGuards.length;
      changes.push({
        type: 'guard-removed',
        severity: 'error',
        functionName: fnName,
        filePath,
        line: newFn.startLine,
        description: `${removedCount} guard(s) removed from ${fnName} (had ${oldGuards.length}, now ${newGuards.length})`,
        oldValue: oldGuards.map(g => summarizeConcept(g)).join('; '),
        newValue: newGuards.map(g => summarizeConcept(g)).join('; '),
      });
    }

    // ── Error Handling ──────────────────────────────────────────────────
    const oldErrorHandlers = filterByKind(oldFnConcepts, 'error_handle');
    const newErrorHandlers = filterByKind(newFnConcepts, 'error_handle');

    if (oldErrorHandlers.length > 0 && newErrorHandlers.length === 0) {
      const descriptions = oldErrorHandlers.map(e => summarizeConcept(e)).join('; ');
      changes.push({
        type: 'error-handling-removed',
        severity: 'warning',
        functionName: fnName,
        filePath,
        line: newFn.startLine,
        description: `Error handling removed from ${fnName}`,
        oldValue: descriptions,
      });
    } else if (oldErrorHandlers.length === 0 && newErrorHandlers.length > 0) {
      changes.push({
        type: 'error-handling-added',
        severity: 'info',
        functionName: fnName,
        filePath,
        line: newFn.startLine,
        description: `Error handling added to ${fnName}`,
        newValue: newErrorHandlers.map(e => summarizeConcept(e)).join('; '),
      });
    }

    // ── Effects (I/O) ───────────────────────────────────────────────────
    const oldEffects = filterByKind(oldFnConcepts, 'effect');
    const newEffects = filterByKind(newFnConcepts, 'effect');

    // Find new effects not present in old version (by subtype + target)
    const oldEffectSigs = new Set(oldEffects.map(e => {
      const payload = e.payload as { subtype: string; target?: string };
      return `${payload.subtype}:${payload.target || ''}`;
    }));

    for (const effect of newEffects) {
      const payload = effect.payload as { subtype: string; target?: string };
      const sig = `${payload.subtype}:${payload.target || ''}`;
      if (!oldEffectSigs.has(sig)) {
        changes.push({
          type: 'effect-added',
          severity: 'info',
          functionName: fnName,
          filePath,
          line: effect.primarySpan.startLine,
          description: `New ${payload.subtype} effect in ${fnName}: ${summarizeConcept(effect)}`,
          newValue: summarizeConcept(effect),
        });
      }
    }

    // Find removed effects
    const newEffectSigs = new Set(newEffects.map(e => {
      const payload = e.payload as { subtype: string; target?: string };
      return `${payload.subtype}:${payload.target || ''}`;
    }));

    for (const effect of oldEffects) {
      const payload = effect.payload as { subtype: string; target?: string };
      const sig = `${payload.subtype}:${payload.target || ''}`;
      if (!newEffectSigs.has(sig)) {
        changes.push({
          type: 'effect-removed',
          severity: 'info',
          functionName: fnName,
          filePath,
          line: newFn.startLine,
          description: `${payload.subtype} effect removed from ${fnName}`,
          oldValue: summarizeConcept(effect),
        });
      }
    }
  }

  // Sort: errors first, then warnings, then info
  const severityOrder = { error: 0, warning: 1, info: 2 };
  changes.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return changes;
}

// ── High-level API ──────────────────────────────────────────────────────

/**
 * Compute semantic diff given old source string and new report data.
 *
 * This is the main entry point for the CLI — handles IR inference and
 * concept extraction from both old and new source internally.
 *
 * @param oldSource - Source code from the base version
 * @param newInferred - Inferred IR from the new version (from review pipeline)
 * @param filePath - Relative or absolute file path
 * @param newSource - New source code (used to extract concepts if provided)
 */
export function computeSemanticDiffFromSource(
  oldSource: string,
  newInferred: InferResult[],
  filePath: string,
  newSource?: string,
): SemanticChange[] {
  try {
    // Infer IR from old source
    const oldInferred = inferFromSource(oldSource, filePath);

    // Extract concepts from old source
    let oldConcepts: ConceptMap | undefined;
    try {
      const project = createInMemoryProject();
      const sf = project.createSourceFile(filePath, oldSource);
      oldConcepts = extractTsConcepts(sf, filePath);
    } catch {
      // Concept extraction failed — proceed with IR-only diff
    }

    // Extract concepts from new source
    let newConcepts: ConceptMap | undefined;
    if (newSource) {
      try {
        const project = createInMemoryProject();
        const sf = project.createSourceFile(filePath, newSource);
        newConcepts = extractTsConcepts(sf, filePath);
      } catch {
        // Concept extraction failed — proceed with IR-only diff
      }
    }

    return computeSemanticDiff(oldInferred, newInferred, oldConcepts, newConcepts, filePath);
  } catch {
    // If old source fails to parse, return empty — don't crash the pipeline
    return [];
  }
}

// ── Formatting ──────────────────────────────────────────────────────────

/** Format semantic changes as a <kern-diff> section for LLM review. */
export function formatSemanticDiff(changes: SemanticChange[], filePath: string): string {
  if (changes.length === 0) return '';

  const lines: string[] = [`<kern-diff path="${filePath}">`];
  for (const c of changes) {
    const detail = c.oldValue && c.newValue
      ? ` (was: ${c.oldValue.substring(0, 60)})`
      : c.oldValue
        ? ` (was: ${c.oldValue.substring(0, 60)})`
        : '';
    lines.push(`  [${c.severity}] ${c.type}: ${c.functionName} — ${c.description}${detail}`);
  }
  lines.push('</kern-diff>');
  return lines.join('\n');
}

/** Convert semantic changes to ReviewFindings for inclusion in reports. */
export function semanticChangesToFindings(
  changes: SemanticChange[],
): import('./types.js').ReviewFinding[] {
  return changes.map(c => ({
    source: 'kern' as const,
    ruleId: `semantic-diff/${c.type}`,
    severity: c.severity,
    category: 'structure' as const,
    message: c.description,
    primarySpan: {
      file: c.filePath,
      startLine: c.line,
      startCol: 1,
      endLine: c.line,
      endCol: 1,
    },
    suggestion: c.type === 'guard-removed'
      ? 'Verify this guard removal was intentional — it may leave the function unprotected'
      : c.type === 'error-handling-removed'
        ? 'Verify this error handling removal was intentional — errors may now go unhandled'
        : undefined,
    fingerprint: `semantic-diff/${c.type}:${c.functionName}:${c.line}`,
  }));
}
