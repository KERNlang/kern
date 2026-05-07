/**
 * External Tools — ESLint Node API + ts-morph diagnostics integration.
 *
 * Uses Node APIs (not child processes). Batched per tsconfig.
 * ESLint is an optional peer dependency — gracefully degrades if not available.
 *
 * Phase 3 of the review pipeline.
 */

import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import type { Project } from 'ts-morph';
import { createProject } from './inferrer.js';
import { debugDetail, type ReviewHealthBuilder } from './review-health.js';
import type { InferResult, ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

function optionalPackageName(...parts: string[]): string {
  return parts.join('');
}

function importOptionalModule(specifier: string): Promise<unknown> {
  return import(specifier);
}

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
  const eslintModuleName = optionalPackageName('es', 'lint');
  let ESLint: any;
  try {
    const eslintModule = (await importOptionalModule(eslintModuleName)) as any;
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
   * When true, suppress TS diagnostics that fire as kern-review infrastructure noise when we inject
   * ad-hoc files into a Project that carries a host tsconfig. Suppressed codes fall into two classes:
   *
   *   Project membership (in-memory Project vs host rootDir):
   *   - TS6059  — "File is not listed within the file list of project"
   *   - TS6307  — "File is not under 'rootDir'"
   *
   *   Environmental (in-memory Project doesn't mirror host compilerOptions — moduleResolution, jsx, lib):
   *   - TS2792  — "Cannot find module X. Did you mean to set 'moduleResolution' to 'nodenext'?"
   *   - TS17004 — "Cannot use JSX unless the '--jsx' flag is provided"
   *   - TS2580 / TS2591 — "Cannot find name 'process'/'require'/'module'" (@types/node missing)
   *
   * The dev already sees the environmental class in their IDE / local `tsc --noEmit` when real.
   * Set this only for the standard review path. The --lint path must leave it false so real
   * tsconfig misconfigurations still surface as errors.
   *
   * The name is kept for backward compatibility; scope broadened deliberately.
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
      // The following codes are environmental: they reflect ts-morph's in-memory Project not
      // perfectly mirroring the host's compilerOptions (moduleResolution, jsx, lib). The dev
      // already sees them in their IDE / local `tsc --noEmit` if real; the review's value-add
      // is KERN-relevant findings, not duplicating compiler output. A sweep of the agon repo
      // (451 files) emitted 1869 of these as errors — pure noise drowning real findings.
      //   ts2792  — "Cannot find module X. Did you mean to set 'moduleResolution' to 'nodenext'?"
      //   ts17004 — "Cannot use JSX unless the '--jsx' flag is provided"
      //   ts2580 / ts2591 — "Cannot find name 'process'/'require'/'module'. Install @types/node?"
      //     (TS emits 2580 when the name resolves via global lib shims, 2591 when it doesn't —
      //     both point at the same user-side remedy, both are environmental from review's POV.)
      //   ts2304 / ts2552 with a Node-global name — same class as 2580/2591, but TS only emits
      //     the Install-@types/node hint for a small denylist of names. URL, URLSearchParams,
      //     __dirname, __filename, Buffer, NodeJS, AbortController, etc. fail through 2304/2552
      //     instead. kern-guard runs review on shallow-cloned repos with no node_modules — the
      //     same root cause as 2580/2591 but a much wider FP surface (kern-sight PR #7 hit it
      //     on plain `let url: URL`). Suppress when the missing name matches a known
      //     @types/node-provided global; non-matching 2304/2552 still surface as type errors.
      const isLoadingNoise = code === 6059 || code === 6307;
      const isEnvironmentalNoise = code === 2792 || code === 17004 || code === 2580 || code === 2591;
      // TS2503 ("Cannot find namespace 'X'") is the same class for type-position
      // uses like `let x: NodeJS.Timeout` — the @types/node `NodeJS` namespace
      // isn't reachable. TS2584 ("Cannot find name 'console'. Do you need to
      // change your target library?") fires for `console` specifically and
      // belongs in the same noise class. Both are environmental, gated on
      // the same review-mode flag. Gemini + Codex caught these.
      const isNodeGlobalUnresolved =
        (code === 2304 || code === 2552 || code === 2503 || code === 2584) && isNodeGlobalCannotFindName(messageStr);
      if (
        options.downgradeProjectLoadingErrors &&
        (isLoadingNoise ||
          isEnvironmentalNoise ||
          isNodeGlobalUnresolved ||
          isReviewModeModuleResolutionNoise(code, messageStr, filePath))
      ) {
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

// Names provided as globals by @types/node. When a TS2304/TS2552 references
// one of these, the missing-types diagnosis is the same as TS2580/TS2591
// for `process`/`require`/`module` — @types/node isn't reachable, which is
// expected when reviewing a shallow-cloned repo with no node_modules.
//
// The list deliberately stops at "names dev code commonly types directly".
// More exotic Node globals (Worker, MessageChannel, etc.) typically appear
// only in code that already imports them — leaving them out keeps real
// usage errors visible.
const NODE_GLOBAL_NAMES = new Set([
  // URL / module-system globals
  'URL',
  'URLSearchParams',
  '__dirname',
  '__filename',
  'Buffer',
  'NodeJS',
  // Modern Node globals — Node 18+ exposes `fetch`/Web-platform fetch types as globals
  'fetch',
  'Request',
  'Response',
  'Headers',
  'FormData',
  'Blob',
  'File',
  // Timers — return types depend on @types/node (`NodeJS.Timeout`)
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'queueMicrotask',
  // Web crypto / encoding (global in Node 18+)
  'crypto',
  'TextEncoder',
  'TextDecoder',
  'atob',
  'btoa',
  // Abort & events
  'AbortController',
  'AbortSignal',
  'Event',
  'EventTarget',
  // Misc
  'performance',
  'structuredClone',
  'global',
  'console',
  'navigator',
]);

// True when a TS2304/TS2552/TS2503 message references one of the
// @types/node-provided globals above. Handles both:
//   - "Cannot find name 'X'." (TS2304 / TS2552 — value position)
//   - "Cannot find namespace 'X'." (TS2503 — type position, e.g. `NodeJS.Timeout`)
function isNodeGlobalCannotFindName(message: string): boolean {
  const m = message.match(/^Cannot find (?:name|namespace) '([^']+)'\.?/);
  if (!m) return false;
  return NODE_GLOBAL_NAMES.has(m[1]);
}

function isReviewModeModuleResolutionNoise(code: number, message: string, importerFilePath: string): boolean {
  if (code !== 2307) return false;

  const specifier = extractMissingModuleSpecifier(message);
  if (!specifier) return false;

  // KERN-generated facades are commonly imported as `.js` from TS source and
  // materialized by `kern compile`. In guard mode, a missing generated facade is
  // pipeline ordering noise unless the explicit lint/typecheck phase says
  // otherwise.
  if (isGeneratedModuleSpecifier(specifier)) return true;

  // Bare package misses (`vitest`, `ai`, etc.) are dependency-install or workspace
  // context failures in review mode. The explicit `--lint` tsc path still reports
  // them as real compiler errors.
  if (isBareModuleSpecifier(specifier)) return true;

  // TS ESM commonly imports `./foo.js` while the source file is `foo.ts`. If the
  // corresponding TS source exists, this is a moduleResolution mismatch in
  // review's ad-hoc Project, not a code bug.
  return isTsBackedJsSpecifier(specifier, importerFilePath);
}

function extractMissingModuleSpecifier(message: string): string | undefined {
  const match = message.match(/Cannot find module ['"]([^'"]+)['"]/);
  return match?.[1];
}

function isGeneratedModuleSpecifier(specifier: string): boolean {
  const normalized = specifier.replace(/\\/g, '/');
  return /(?:^|\/)generated\//.test(normalized) || /(?:^|\/)__generated__\//.test(normalized);
}

function isBareModuleSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(specifier);
}

function isTsBackedJsSpecifier(specifier: string, importerFilePath: string): boolean {
  if (!specifier.startsWith('.') || !/\.(?:mjs|cjs|js|jsx)$/.test(specifier)) return false;

  const resolved = resolve(dirname(importerFilePath), specifier);
  const withoutJsExt = resolved.replace(/\.(?:mjs|cjs|js|jsx)$/, '');
  return ['.ts', '.tsx', '.mts', '.cts', '.d.ts'].some((ext) => existsSync(`${withoutJsExt}${ext}`));
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
