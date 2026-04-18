/**
 * Types for @kernlang/codemod.
 *
 * TemplateMatch from @kernlang/review is treated as a candidate signal only.
 * Each TemplateAdapter re-derives the exact AST span, extracts CHILDREN from
 * the user's interior, and returns a RewritePlan. The orchestrator applies
 * the plan, then gates the write behind reparse, re-detect, and a two-stage
 * diagnostics check.
 */

import type { TemplateMatch } from '@kernlang/review';
import type { SourceFile } from 'ts-morph';

// ── Adapter contract ──────────────────────────────────────────────────

/** Exact replacement span in the source file, anchored by an adapter. */
export interface ResolvedRegion {
  /** Character offset start (inclusive) */
  start: number;
  /** Character offset end (exclusive) */
  end: number;
  /** Human-readable description used in audit/logging (e.g. "VariableStatement at L12") */
  label: string;
}

/** Result of extracting the user's interior into CHILDREN lines. */
export type ExtractResult = { ok: true; children: string[] } | { ok: false; reason: string };

/** Result of resolving the replacement region. */
export type ResolveResult = { ok: true; region: ResolvedRegion } | { ok: false; reason: string };

/** A template adapter owns one templateName's rewrite semantics end-to-end. */
export interface TemplateAdapter {
  /** Matches TemplateMatch.templateName (e.g. 'zustand-store') */
  readonly templateName: string;
  /** Re-derive the real rewrite span from the candidate match. */
  resolveRegion(sourceFile: SourceFile, match: TemplateMatch): ResolveResult;
  /** Extract the user interior as KERN child lines to be injected as {{CHILDREN}}. */
  extractChildren(sourceFile: SourceFile, region: ResolvedRegion, match: TemplateMatch): ExtractResult;
}

// ── Apply API ──────────────────────────────────────────────────────────

export interface ApplyOptions {
  /** Actually write to disk. Default false (dry-run). */
  write?: boolean;
  /** Minimum confidence percentage to consider (0-100). Default 80. */
  minConfidence?: number;
  /** Restrict to a single template name. */
  templateName?: string;
  /** Path to write audit JSONL. Default .kern/codemod-audit.jsonl under cwd. */
  auditPath?: string;
  /** Override cwd (affects tsconfig lookup + audit path). */
  cwd?: string;
}

export type ApplyDecision = 'applied' | 'dry-run' | 'skipped' | 'rejected';

export interface ApplyResult {
  filePath: string;
  templateName: string;
  confidencePct: number;
  decision: ApplyDecision;
  reason?: string;
  /** Span that was replaced (character offsets). Present when adapter resolved. */
  replacedSpan?: { start: number; end: number };
  /** Unified diff between original and transformed text (present for applied/dry-run). */
  diff?: string;
  /** True when transformed text parsed cleanly. */
  parseOk?: boolean;
  /** True when post-transform re-detection no longer finds the original match. */
  reDetectOk?: boolean;
  /** New tsc diagnostics introduced by this edit (empty = safe). */
  newDiagnostics?: string[];
  tsTokens?: number;
  kernTokens?: number;
  /** ISO-8601 */
  timestamp: string;
}

// ── Audit entry (written to JSONL) ────────────────────────────────────

export type AuditEntry = ApplyResult & {
  /** Schema version for forward compatibility */
  schema: 1;
};
