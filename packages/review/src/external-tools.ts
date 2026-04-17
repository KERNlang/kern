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
import type { InferResult, ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

// ── ESLint via Node API ──────────────────────────────────────────────────

/**
 * Run ESLint on given file paths using the Node API.
 * Returns normalized ReviewFinding[] with source='eslint'.
 * Returns empty array if ESLint is not installed.
 */
export async function runESLint(filePaths: string[], cwd: string): Promise<ReviewFinding[]> {
  try {
    // Dynamic import — ESLint is an optional peer dep
    const eslintModuleName = 'eslint';
    const eslintModule = (await import(eslintModuleName)) as any;
    const ESLint = eslintModule.ESLint || eslintModule.default?.ESLint;
    if (!ESLint) return [];

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
  } catch {
    // ESLint not installed or failed to load
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
   * When true, downgrade TS6059 ("file not listed in project") and TS6307 ("file not under rootDir")
   * from error to info. Set this only for callers that inject ad-hoc files into a Project that carries
   * a host tsconfig — those two codes then fire as infrastructure noise, not user bugs. The --lint
   * path must leave this false so a real tsconfig misconfiguration still surfaces as an error.
   */
  downgradeProjectLoadingErrors?: boolean;
}

/**
 * Run TypeScript compiler diagnostics using ts-morph's existing Project.
 * Reuses the Project already created by the inferrer — no extra compilation.
 */
export function runTSCDiagnostics(project: Project, options: RunTSCDiagnosticsOptions = {}): ReviewFinding[] {
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

      // ts6059 / ts6307 fire both for real tsconfig misconfigurations (error) and for kern-review's
      // ad-hoc file injection into a host tsconfig (noise). The caller decides which mode we're in
      // via options.downgradeProjectLoadingErrors.
      //   ts6059 — "File is not listed within the file list of project"
      //   ts6307 — "File is not under 'rootDir'"
      const isLoadingNoise = code === 6059 || code === 6307;
      const effectiveSeverity: ReviewFinding['severity'] =
        isLoadingNoise && options.downgradeProjectLoadingErrors ? 'info' : severity;

      findings.push({
        source: 'tsc',
        ruleId: `ts${code}`,
        severity: effectiveSeverity,
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
    if (process.env.KERN_DEBUG) console.error('tsc diagnostics error:', (err as Error).message);
  }

  return findings;
}

// ── tsc Diagnostics from file paths ───────────────────────────────────

/**
 * Run TypeScript compiler diagnostics from file paths (no pre-existing Project).
 * Creates a real-filesystem Project, adds files, runs diagnostics.
 * Used by the CLI --lint path where only file paths are available.
 */
export function runTSCDiagnosticsFromPaths(filePaths: string[]): ReviewFinding[] {
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
  } catch {
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
