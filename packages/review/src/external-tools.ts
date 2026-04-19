/**
 * External Tools — ESLint Node API + ts-morph diagnostics integration.
 *
 * Uses Node APIs (not child processes). Batched per tsconfig.
 * ESLint is an optional peer dependency — gracefully degrades if not available.
 *
 * Phase 3 of the review pipeline.
 */

import type { Project } from 'ts-morph';
import { createProject } from './inferrer.js';
import { debugDetail, type ReviewHealthBuilder } from './review-health.js';
import type { InferResult, ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

/**
 * Node-style error check — used to distinguish "optional peer dep missing" (quietly skip)
 * from "the peer dep is installed but failed to load" (surface as degraded-mode health note).
 * Matches both the standard MODULE_NOT_FOUND on require() and the ERR_MODULE_NOT_FOUND
 * emitted by native ESM dynamic import.
 */
function isModuleNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
}

// ── ESLint via Node API ──────────────────────────────────────────────────

/**
 * Run ESLint on given file paths using the Node API.
 * Returns normalized ReviewFinding[] with source='eslint'.
 *
 * ESLint is an optional peer dep. If it's not installed, we record a `skipped` health
 * note (no findings). If it IS installed but fails at load or lint time — that's a real
 * infrastructure problem: we record an `error` health note so the caller can surface
 * "ran in degraded mode" rather than silently returning an empty findings array that
 * looks identical to a clean run.
 */
export async function runESLint(
  filePaths: string[],
  cwd: string,
  health?: ReviewHealthBuilder,
): Promise<ReviewFinding[]> {
  // Dynamic import — ESLint is an optional peer dep. MODULE_NOT_FOUND at this step means
  // "not installed" (quiet skip); anything else is a real load failure worth surfacing.
  const eslintModuleName = 'eslint';
  let ESLint: any;
  try {
    const eslintModule = (await import(eslintModuleName)) as any;
    ESLint = eslintModule.ESLint || eslintModule.default?.ESLint;
  } catch (err) {
    if (isModuleNotFound(err)) {
      health?.noteKind('eslint', 'skipped', 'ESLint not installed — skipped');
      return [];
    }
    health?.noteKind('eslint', 'error', 'ESLint failed to load', debugDetail(err));
    if (process.env.KERN_DEBUG) console.error('ESLint load error:', (err as Error).message);
    return [];
  }
  if (!ESLint) {
    health?.noteKind('eslint', 'skipped', 'ESLint package present but missing ESLint export — skipped');
    return [];
  }

  try {
    const eslint = new ESLint({ cwd });
    const results = await eslint.lintFiles(filePaths);

    const findings: ReviewFinding[] = [];

    for (const result of results as any[]) {
      for (const msg of result.messages as any[]) {
        const severity: ReviewFinding['severity'] =
          msg.severity === 2 ? 'error' : msg.severity === 1 ? 'warning' : 'info';

        const primarySpan: SourceSpan = {
          file: result.filePath,
          startLine: msg.line,
          startCol: msg.column,
          endLine: msg.endLine ?? msg.line,
          endCol: msg.endColumn ?? msg.column,
        };

        findings.push({
          source: 'eslint',
          ruleId: msg.ruleId || 'eslint-unknown',
          severity,
          category: categorizeESLintRule(msg.ruleId || ''),
          message: msg.message,
          primarySpan,
          suggestion: msg.fix ? 'Auto-fixable' : undefined,
          fingerprint: createFingerprint(msg.ruleId || 'eslint', msg.line, msg.column),
        });
      }
    }

    return findings;
  } catch (err) {
    // ESLint loaded but lintFiles threw — typically a malformed eslint.config or unreadable
    // files. This is a real failure: surface it on health rather than letting a silent []
    // look like "ESLint ran and found nothing."
    health?.noteKind('eslint', 'error', 'ESLint failed during lint run', debugDetail(err));
    if (process.env.KERN_DEBUG) console.error('ESLint lint error:', (err as Error).message);
    return [];
  }
}

/**
 * Map ESLint rule IDs to ReviewFinding categories.
 */
function categorizeESLintRule(ruleId: string): ReviewFinding['category'] {
  if (ruleId.includes('no-unused') || ruleId.includes('prefer-')) return 'style';
  if (ruleId.includes('no-undef') || ruleId.includes('type')) return 'type';
  if (ruleId.includes('security') || ruleId.includes('injection')) return 'bug';
  if (ruleId.includes('import') || ruleId.includes('module')) return 'structure';
  return 'pattern';
}

// ── tsc Diagnostics via ts-morph ─────────────────────────────────────────

export interface RunTSCDiagnosticsOptions {
  /**
   * When true, suppress TS6059/TS6307 project-loading diagnostics. Set this only for callers that
   * inject ad-hoc files into a Project that carries a host tsconfig — those two codes then fire as
   * infrastructure noise, not user bugs. The --lint path must leave this false so a real tsconfig
   * misconfiguration still surfaces as an error.
   */
  downgradeProjectLoadingErrors?: boolean;
}

/**
 * Run TypeScript compiler diagnostics using ts-morph's existing Project.
 * Reuses the Project already created by the inferrer — no extra compilation.
 */
export function runTSCDiagnostics(
  project: Project,
  options: RunTSCDiagnosticsOptions = {},
  health?: ReviewHealthBuilder,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  try {
    const diagnostics = project.getPreEmitDiagnostics();

    for (const diag of diagnostics) {
      const sourceFile = diag.getSourceFile();
      if (!sourceFile) continue;

      const filePath = sourceFile.getFilePath();
      const start = diag.getStart();
      const length = diag.getLength();

      let startLine = 1;
      let startCol = 1;
      let endLine = 1;
      let endCol = 1;

      if (start !== undefined) {
        const startPos = sourceFile.getLineAndColumnAtPos(start);
        startLine = startPos.line;
        startCol = startPos.column;

        if (length !== undefined) {
          const endPos = sourceFile.getLineAndColumnAtPos(start + length);
          endLine = endPos.line;
          endCol = endPos.column;
        } else {
          endLine = startLine;
          endCol = startCol;
        }
      }

      const category = diag.getCategory();
      const severity: ReviewFinding['severity'] =
        category === 1 /* Error */ ? 'error' : category === 0 /* Warning */ ? 'warning' : 'info';

      const code = diag.getCode();
      const message = diag.getMessageText();
      const messageStr = typeof message === 'string' ? message : message.getMessageText();

      // ts6059 / ts6307 fire both for real tsconfig misconfigurations and for kern-review's
      // ad-hoc file injection into a host tsconfig (noise). The caller decides which mode we're in
      // via options.downgradeProjectLoadingErrors. In review mode we drop them entirely; surfacing
      // them as info still pollutes every barrel/re-export report in composite monorepos.
      //   ts6059 — "File is not listed within the file list of project"
      //   ts6307 — "File is not under 'rootDir'"
      const isLoadingNoise = code === 6059 || code === 6307;
      if (isLoadingNoise && options.downgradeProjectLoadingErrors) {
        continue;
      }

      findings.push({
        source: 'tsc',
        ruleId: `ts${code}`,
        severity,
        category: 'type',
        message: messageStr,
        primarySpan: {
          file: filePath,
          startLine,
          startCol,
          endLine,
          endCol,
        },
        fingerprint: createFingerprint(`ts${code}`, startLine, startCol),
      });
    }
  } catch (err) {
    // ts-morph diagnostics can fail on malformed source — return what we have
    health?.noteKind('tsc', 'error', 'tsc diagnostics failed mid-run', debugDetail(err));
    if (process.env.KERN_DEBUG) console.error('tsc diagnostics error:', (err as Error).message);
  }

  return findings;
}

// ── tsc Diagnostics from file paths ───────────────────────────────────

/**
 * Run TypeScript compiler diagnostics from file paths (no pre-existing Project).
 * Creates a real-filesystem Project, adds files, runs diagnostics.
 * Used by the CLI --lint path where only file paths are available.
 *
 * If the Project fails to construct (missing tsconfig, bad compilerOptions), we record an
 * `error` health note rather than silently returning []. Per-file addSourceFileAtPath
 * failures are normal for unreadable/unparseable files and are intentionally skipped.
 */
export function runTSCDiagnosticsFromPaths(filePaths: string[], health?: ReviewHealthBuilder): ReviewFinding[] {
  if (filePaths.length === 0) return [];

  try {
    const project = createProject(filePaths[0]);
    for (const fp of filePaths) {
      try {
        project.addSourceFileAtPath(fp);
      } catch (_e) {
        void _e; // intentional: skip unreadable/unparseable files
      }
    }
    return runTSCDiagnostics(project);
  } catch (err) {
    health?.noteKind('tsc', 'error', 'tsc diagnostics could not build a ts-morph Project', debugDetail(err));
    if (process.env.KERN_DEBUG) console.error('tsc project build error:', (err as Error).message);
    return [];
  }
}

// ── Link External Findings to KERN NodeIds ───────────────────────────────

/**
 * For each external finding, find the inferred node whose sourceSpan contains it.
 * Attaches nodeId to the finding for cross-referencing.
 */
export function linkToNodes(findings: ReviewFinding[], inferred: InferResult[]): ReviewFinding[] {
  for (const f of findings) {
    if (f.nodeIds && f.nodeIds.length > 0) continue; // already linked

    const line = f.primarySpan.startLine;
    const matchingNode = inferred.find((r) => r.startLine <= line && r.endLine >= line);

    if (matchingNode) {
      f.nodeIds = [matchingNode.nodeId];
    }
  }

  return findings;
}
