/**
 * External Tools — ESLint Node API + ts-morph diagnostics integration.
 *
 * Uses TypeScript/ESLint Node APIs. Batched per tsconfig.
 * ESLint is an optional peer dependency — gracefully degrades if not available.
 *
 * Phase 3 of the review pipeline.
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { Node, type Project, type SourceFile, SyntaxKind, type Node as TsMorphNode, type Type } from 'ts-morph';
import { createProject, findTsConfig } from './inferrer.js';
import { debugDetail, type ReviewHealthBuilder } from './review-health.js';
import { isTestLikeFilePath, isTestRunnerGlobalCannotFindName } from './test-runner-noise.js';
import type { InferResult, ReviewFinding, SourceSpan } from './types.js';
import { createFingerprint } from './types.js';

const packageRequire = createRequire(import.meta.url);

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
          confidence: 88,
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
  /** Compare suspected ts-morph-only diagnostics against canonical on-disk tsc output. */
  canonicalFilePaths?: string[];
  /** Request-scoped canonical build results shared by multi-file review callers. */
  canonicalBuildDiagnosticsCache?: Map<string, Set<string> | undefined>;
}

// TS diagnostic codes in the "type erosion" family — the downstream cascade
// that fires when an import is unresolved. An unresolved import degrades its
// type to `any`, and derived values then fall to `unknown` (e.g.
// `Object.entries(anyValue)` yields `[string, unknown][]` because the generic
// `T` defaults to `unknown` when uninferable). These are suppressed in review
// mode ONLY inside a file that already has a suppressed module miss — see the
// gate in runTSCDiagnostics for the full rationale.
//   18046 — "'x' is of type 'unknown'."
//   2571  — "Object is of type 'unknown'." (object-expression variant)
//   2698  — "Spread types may only be created from object types."
const UNRESOLVED_IMPORT_EROSION_CODES = new Set<number>([18046, 2571, 2698]);

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
    const { keys: suppressedModuleMisses, files: filesWithSuppressedModuleMiss } = options.downgradeProjectLoadingErrors
      ? collectReviewModeSuppressedModuleMisses(diagnostics)
      : { keys: new Set<string>(), files: new Set<string>() };
    // File-level pre-pass: which files have a broken JSX global namespace?
    // When @types/react is unreachable (kern-guard's sparse clone, no
    // node_modules), `JSX.IntrinsicElements` and `JSX.ElementChildrenAttribute`
    // are undefined. TS then emits TS7026 on every host JSX element AND a
    // TS2741 "Property 'children' is missing" on every JSX user-component
    // call site whose props declare `children: ReactNode` — because
    // children-routing through `<Tag>...</Tag>` form is no longer wired up.
    // The TS2741 is purely environmental noise here; the dev's local
    // `tsc --noEmit` (which DOES resolve @types/react) passes cleanly.
    // Mirror the @types/node-globals pattern: detect once per file, then
    // suppress co-firing TS2741-children in the per-diagnostic loop below.
    const brokenJsxNamespaceFiles = options.downgradeProjectLoadingErrors
      ? collectBrokenJsxNamespaceFiles(diagnostics)
      : new Set<string>();

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
      //   ts6142  — "Module 'X' was resolved to 'Y', but '--jsx' is not set." The
      //     import-a-.tsx-file twin of ts17004: same root cause (the host
      //     tsconfig's jsx option never applied — e.g. `extends: "expo/tsconfig.base"`
      //     is unresolvable without node_modules in the sparse clone), and it
      //     fires on EVERY .tsx import, so it dominated fitvt PR #19's noise.
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
      // TS7026 ("JSX element implicitly has type 'any' because no interface
      // 'JSX.IntrinsicElements' exists") is the JSX counterpart to TS17004 —
      // the JSX global namespace from @types/react isn't reachable in the
      // sparse clone. Suppress unconditionally in review mode; the dev's IDE
      // sees the real shape via their installed node_modules.
      const isEnvironmentalNoise =
        code === 2792 || code === 17004 || code === 6142 || code === 2580 || code === 2591 || code === 7026;
      // TS2503 ("Cannot find namespace 'X'") is the same class for type-position
      // uses like `let x: NodeJS.Timeout` — the @types/node `NodeJS` namespace
      // isn't reachable. TS2584 ("Cannot find name 'console'. Do you need to
      // change your target library?") fires for `console` specifically and
      // belongs in the same noise class. Both are environmental, gated on
      // the same review-mode flag. Gemini + Codex caught these.
      const isNodeGlobalUnresolved =
        (code === 2304 || code === 2552 || code === 2503 || code === 2584) &&
        (isNodeGlobalCannotFindName(messageStr) || isWebRuntimeGlobalCannotFindName(messageStr));
      // TS2582 / TS2593 — "Cannot find name 'describe'. Do you need to install
      // type definitions for a test runner?" TS emits these two codes ONLY for
      // its hardcoded test-runner name list (describe / suite / it / test /
      // beforeEach / afterEach / …): 2582 when no @types/jest|mocha is
      // installed, 2593 when installed but absent from the tsconfig `types`
      // field. Both mean the host's test-runner ambient types
      // (types: ["jest"], vitest globals) aren't reachable from review's
      // ad-hoc Project — the same class as TS2580/TS2591 for @types/node.
      // Globals NOT on TS's hint list (expect, jest, vi, …) fall through as
      // plain TS2304/TS2552, and namespace-position uses (`let m: jest.Mock`)
      // as TS2503. ALL legs are gated to test-like files (.test./.spec./
      // __tests__/setup files), so a stray test-runner global in production
      // code still surfaces (codex review caught that 2582/2593 fire for
      // describe/it in any file, not just tests; agy caught the 2503 leg).
      // kern-guard flagged every describe/it/expect in a React-Native repo
      // whose local `pnpm typecheck` was clean (456/456 tests) — pure sandbox
      // noise from the missing `types: ["jest"]`.
      const isTestRunnerGlobalUnresolved =
        (code === 2582 ||
          code === 2593 ||
          ((code === 2304 || code === 2552 || code === 2503) && isTestRunnerGlobalCannotFindName(messageStr))) &&
        isTestLikeFilePath(filePath);
      // TS2741 "Property 'children' is missing" on a JSX user-component call
      // site is environmental whenever the JSX global namespace is broken in
      // the same file. Without `JSX.ElementChildrenAttribute`, TS does not
      // route `<Tag>...children...</Tag>` content into the `children` prop,
      // so every component that declares `children: ReactNode` as required
      // looks like it's missing the prop. Gate strictly: file must be in
      // brokenJsxNamespaceFiles AND the diagnostic must specifically be
      // about a missing `children` property. This preserves real TS2741s
      // for other missing props.
      const isJsxChildrenInferenceNoise =
        code === 2741 && brokenJsxNamespaceFiles.has(filePath) && isMissingChildrenDiagnostic(messageStr);
      // TS2875 — the automatic-runtime (jsx:'react-jsx') exports-subpath analog
      // of the TS2307 bare-module miss review mode already downgrades. Review
      // path only; the explicit --lint/typecheck path still surfaces it so a
      // repo genuinely lacking the JSX runtime is reported. See
      // isBrokenJsxRuntimeDiagnostic for why the message gate is safe.
      const isBrokenJsxRuntimeNoise = code === 2875 && isBrokenJsxRuntimeDiagnostic(messageStr);
      // TS18046 / TS2698 / TS2571 — the type-erosion cascade of a suppressed
      // module miss. An unresolved import (TS2307, downgraded above) degrades
      // its type to `any`; `Object.entries(anyValue)` then yields
      // `[string, unknown][]`, so any downstream `u.x` trips TS18046 and
      // `{ ...u }` trips TS2698 (TS2571 is the object-expression variant). All
      // vanish once the package resolves — a full `tsc -b` with deps built is
      // clean (proven). kern-guard PR #376 surfaced these on a brand-new
      // workspace package consumed in the same PR. Gated per-file exactly like
      // the TS2741 JSX-children cascade: suppress these codes ONLY in a file
      // that already lost an import to a noise-downgraded miss, so a genuine
      // `unknown`-handling bug in a cleanly-resolved file still surfaces.
      const isUnresolvedImportErosionCascade =
        UNRESOLVED_IMPORT_EROSION_CODES.has(code) && filesWithSuppressedModuleMiss.has(filePath);
      // TS2307 whose (file, specifier) the collector already classified as a
      // review-mode noise miss — including an absent RELATIVE sibling
      // (`./x.helpers` not on disk in the sparse clone). Surfacing the raw
      // "Cannot find module './x.helpers'" is itself a sparse-clone FP; the dev's
      // local `tsc` (siblings present) resolves it. Unifies the raw-2307
      // suppression with the same decisions that drive the TS2305 facade cascade
      // and the TS18046/2571/2698 erosion cascade, so they stay consistent.
      // Review mode only. NOTE: TS2322/TS2345 are deliberately NOT suppressed —
      // an absent sibling erodes an import to `any`, which is assignable to
      // everything and so emits no mismatch; the mechanism could not be
      // reproduced, and blanket-suppressing the highest-value real-bug codes on
      // an unproven cause was rejected.
      const isCollectedModuleMiss =
        code === 2307 &&
        suppressedModuleMisses.has(moduleMissKey(filePath, extractMissingModuleSpecifier(messageStr) ?? ''));
      // TS2339 "Property 'kind' does not exist on type 'never'" can be a
      // review-mode control-flow cascade around KERN's parseExpression value
      // guards. The canonical compiler accepts these files, but ts-morph's
      // sparse/ad-hoc Project can over-narrow the `parsed` variable after
      // the array/record literal guards plus the record-array-field probe, then
      // reports later `parsed.kind`/`parsed.callee` accesses as `never`.
      // Suppress only that AST shape, and only when the parseExpression return
      // type still has non-array/non-record variants; truly exhaustive branches
      // remain real TS2339 findings even in review mode.
      const isParserExpressionNeverCascade = isReviewModeParserExpressionNeverCascade(
        sourceFile,
        code,
        messageStr,
        start,
      );
      if (
        options.downgradeProjectLoadingErrors &&
        (isLoadingNoise ||
          isEnvironmentalNoise ||
          isNodeGlobalUnresolved ||
          isTestRunnerGlobalUnresolved ||
          isJsxChildrenInferenceNoise ||
          isBrokenJsxRuntimeNoise ||
          isUnresolvedImportErosionCascade ||
          isCollectedModuleMiss ||
          isParserExpressionNeverCascade ||
          isReviewModeModuleResolutionNoise(code, messageStr, filePath) ||
          isReviewModeGeneratedFacadeExportCascade(sourceFile, code, messageStr, suppressedModuleMisses))
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
        confidence: 95,
      });
    }
  } catch (err) {
    // ts-morph diagnostics can fail on malformed source — return what we have
    health?.noteKind('tsc', 'error', 'tsc diagnostics failed mid-run', debugDetail(err));
    if (process.env.KERN_DEBUG) console.error('tsc diagnostics error:', (err as Error).message);
  }

  return options.canonicalFilePaths && hasSuspectedCanonicalDiagnostic(findings, options.canonicalFilePaths)
    ? filterToCanonicalBuildDiagnostics(
        findings,
        options.canonicalFilePaths,
        health,
        undefined,
        options.canonicalBuildDiagnosticsCache,
      )
    : findings;
}

function isSuspectedTsMorphOnlyDiagnostic(finding: ReviewFinding): boolean {
  return finding.ruleId === 'ts1470';
}

function hasSuspectedCanonicalDiagnostic(findings: ReviewFinding[], canonicalFilePaths: string[]): boolean {
  const canonicalPaths = new Set(canonicalFilePaths.map(normalizeDiagnosticPath));
  return findings.some(
    (finding) =>
      canonicalPaths.has(normalizeDiagnosticPath(finding.primarySpan.file)) &&
      isSuspectedTsMorphOnlyDiagnostic(finding),
  );
}

function collectReviewModeSuppressedModuleMisses(diagnostics: ReturnType<Project['getPreEmitDiagnostics']>): {
  keys: Set<string>;
  files: Set<string>;
} {
  // `keys` (file\0specifier) drives the TS2305 facade cascade; `files` drives
  // the TS18046/TS2698/TS2571 type-erosion cascade (suppress those codes only
  // in a file that already lost an import to a noise-downgraded module miss).
  const keys = new Set<string>();
  const files = new Set<string>();
  for (const diag of diagnostics) {
    if (diag.getCode() !== 2307) continue;
    const sourceFile = diag.getSourceFile();
    if (!sourceFile) continue;
    const message = diag.getMessageText();
    const messageStr = typeof message === 'string' ? message : message.getMessageText();
    const specifier = extractMissingModuleSpecifier(messageStr);
    if (!specifier) continue;
    if (
      isReviewModeModuleResolutionNoise(2307, messageStr, sourceFile.getFilePath()) ||
      isAbsentRelativeSibling(sourceFile, specifier)
    ) {
      keys.add(moduleMissKey(sourceFile.getFilePath(), specifier));
      files.add(sourceFile.getFilePath());
    }
  }
  return { keys, files };
}

// True when `specifier` is a RELATIVE import/export (`./x`, `../x`) whose target
// resolves to no source file on disk — i.e. a sibling module absent from
// kern-guard's sparse clone (which checks out only the PR's changed files, so a
// screen split into sibling `./x.types` / `./x.helpers` / `./x.sections` modules
// loses those siblings). Distinguished from a bare/generated miss (handled by
// isReviewModeModuleResolutionNoise) and used ONLY in review mode.
//
// Trade-off, made explicit: a genuinely typo'd or deleted relative path is
// indistinguishable from a sparse-clone absence, so treating relative misses as
// noise means review no longer flags a broken relative import. This is
// consistent with the engine's standing philosophy — the dev's local
// `tsc --noEmit` / CI (siblings present) already catches a real broken path;
// review's value-add is KERN findings, not duplicating the compiler. Gated to
// relative specifiers only; bare/package and absolute misses are unaffected.
function isAbsentRelativeSibling(sourceFile: import('ts-morph').SourceFile, specifier: string): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const decls = [...sourceFile.getImportDeclarations(), ...sourceFile.getExportDeclarations()].filter(
    (decl) => decl.getModuleSpecifierValue() === specifier,
  );
  if (decls.length === 0) return false;
  // Absent iff no matching decl resolves to a source file on disk.
  return decls.every((decl) => !decl.getModuleSpecifierSourceFile());
}

// Files where TS reports the JSX global namespace is broken — `@types/react`
// is unreachable, so `JSX.IntrinsicElements` (the host-element shim) and
// `JSX.ElementChildrenAttribute` (the children-routing pointer) are both
// undefined. Two diagnostics signal this cleanly:
//   - TS7026 — emitted on every host JSX element (e.g. `<div>`) in such a
//     file. The presence of any TS7026 in a .tsx/.jsx file is a strong
//     signal the whole JSX-typechecking surface is degraded for that file.
//   - TS2503 with `'JSX'` namespace — direct "Cannot find namespace 'JSX'."
//     when source code references the JSX namespace at type position.
// We deliberately do NOT use TS2604 ("JSX element type X has no construct
// or call signatures") as a signal: it can fire for legitimate misuses of
// non-React-component values in JSX position and would over-suppress.
// (TS2875 — the automatic-runtime jsx-runtime miss — is suppressed directly in
// the diagnostic loop, NOT registered here: under the automatic runtime TS
// errors at TS2875 before children-checking, so no TS2741 children cascade
// co-fires to suppress, and adding 2875-only files here could hide a genuine
// missing-`children` error on a file whose JSX namespace is otherwise intact.)
function collectBrokenJsxNamespaceFiles(diagnostics: ReturnType<Project['getPreEmitDiagnostics']>): Set<string> {
  const files = new Set<string>();
  for (const diag of diagnostics) {
    const code = diag.getCode();
    if (code !== 7026 && code !== 2503) continue;
    const sourceFile = diag.getSourceFile();
    if (!sourceFile) continue;
    if (code === 2503) {
      const message = diag.getMessageText();
      const messageStr = typeof message === 'string' ? message : message.getMessageText();
      if (!/Cannot find namespace ['"]JSX['"]/.test(messageStr)) continue;
    }
    files.add(sourceFile.getFilePath());
  }
  return files;
}

// True when a TS2741 message names `children` as the missing required
// property. TS2741 format: "Property 'X' is missing in type '...' but
// required in type '...'." — capture group 1 is the missing prop name.
// Gated to `children` so other missing-prop diagnostics on the same JSX
// element (e.g. `onClick` legitimately omitted) continue to surface.
function isMissingChildrenDiagnostic(message: string): boolean {
  const match = message.match(/^Property ['"]([^'"]+)['"] is missing/);
  return match?.[1] === 'children';
}

// TS2875 ("This JSX tag requires the module path 'react/jsx-runtime' to exist,
// but none could be found") is the automatic-runtime (jsx:'react-jsx')
// counterpart of the classic-runtime TS7026/TS2503 broken-JSX signals, and the
// exports-subpath analog of the TS2307 bare-module miss review mode already
// downgrades (isReviewModeModuleResolutionNoise): the dev's local `tsc --noEmit`
// resolves `react/jsx-runtime` through the package's `exports` map; review's
// ad-hoc ts-morph Project — sparse clone, no node_modules / no exports-subpath
// resolution — cannot, so it fires per JSX tag.
//
// The message interpolates the unresolved module path: always a quoted
// specifier ending in `/jsx-runtime` or `/jsx-dev-runtime` (react/jsx-runtime,
// react/jsx-dev-runtime, preact/jsx-runtime, @emotion/react/jsx-runtime, …).
// Code 2875 is exclusively this diagnostic, so the gate is belt-and-suspenders
// against a future reuse of the code — anchored to the quoted path (not a bare
// substring) so unrelated prose mentioning "jsx-runtime" cannot match.
const BROKEN_JSX_RUNTIME_RE = /['"][^'"]*\/jsx-(?:dev-)?runtime['"]/;
function isBrokenJsxRuntimeDiagnostic(message: string): boolean {
  return BROKEN_JSX_RUNTIME_RE.test(message);
}

function isReviewModeParserExpressionNeverCascade(
  sourceFile: SourceFile,
  code: number,
  message: string,
  start: number | undefined,
): boolean {
  if (code !== 2339 || start === undefined) return false;
  if (!/^Property ['"][^'"]+['"] does not exist on type ['"]never['"]\./.test(message)) return false;

  const receiver = parserExpressionReceiverAt(sourceFile, start);
  if (!receiver) return false;

  return (
    receiverHasPrecedingCall(receiver, 'isArrayLiteralExpression', start) &&
    receiverHasPrecedingCall(receiver, 'isRecordLiteralExpression', start) &&
    receiverHasPrecedingCall(receiver, 'evalRecordArrayFieldReferenceValue', start) &&
    parseExpressionTypeHasRuntimeBranches(receiver.declaration) &&
    siteHasRuntimeKindGuard(receiver, start)
  );
}

function parserExpressionReceiverAt(
  sourceFile: SourceFile,
  propertyStart: number,
):
  | {
      declaration: import('ts-morph').VariableDeclaration;
      propertyAccess: import('ts-morph').PropertyAccessExpression;
    }
  | undefined {
  const nodeAtDiagnostic = sourceFile.getDescendantAtPos(propertyStart);
  const propertyAccess = Node.isPropertyAccessExpression(nodeAtDiagnostic)
    ? nodeAtDiagnostic
    : nodeAtDiagnostic?.getFirstAncestorByKind(SyntaxKind.PropertyAccessExpression);
  if (!propertyAccess) return undefined;

  const receiver = propertyAccessRootIdentifier(propertyAccess);
  if (!receiver) return undefined;

  const declaration = receiver
    .getSymbol()
    ?.getDeclarations()
    .find((decl): decl is import('ts-morph').VariableDeclaration => Node.isVariableDeclaration(decl));
  if (!declaration) return undefined;

  const initializer = unwrapExpression(declaration.getInitializer());
  if (!initializer || !Node.isCallExpression(initializer)) return undefined;
  if (!isCallNamed(initializer, 'parseExpression')) return undefined;

  return { declaration, propertyAccess };
}

function propertyAccessRootIdentifier(
  propertyAccess: import('ts-morph').PropertyAccessExpression,
): import('ts-morph').Identifier | undefined {
  let expression = unwrapExpression(propertyAccess.getExpression());
  while (expression && Node.isPropertyAccessExpression(expression)) {
    expression = unwrapExpression(expression.getExpression());
  }
  return expression && Node.isIdentifier(expression) ? expression : undefined;
}

function receiverHasPrecedingCall(
  receiver: {
    declaration: import('ts-morph').VariableDeclaration;
    propertyAccess: import('ts-morph').PropertyAccessExpression;
  },
  calleeName: string,
  propertyStart: number,
): boolean {
  const owner = nearestFunctionBoundary(receiver.propertyAccess);
  const searchRoot = owner ?? receiver.propertyAccess.getSourceFile();
  for (const call of searchRoot.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getStart() <= receiver.declaration.getEnd() || call.getStart() >= propertyStart) continue;
    if (!sameOptionalNode(nearestFunctionBoundary(call), owner)) continue;
    if (!isCallNamed(call, calleeName)) continue;
    const firstArg = unwrapExpression(call.getArguments()[0]);
    if (firstArg && Node.isIdentifier(firstArg) && identifierDeclares(firstArg, receiver.declaration)) return true;
  }
  return false;
}

function siteHasRuntimeKindGuard(
  receiver: {
    declaration: import('ts-morph').VariableDeclaration;
    propertyAccess: import('ts-morph').PropertyAccessExpression;
  },
  propertyStart: number,
): boolean {
  const owner = nearestFunctionBoundary(receiver.propertyAccess);
  for (const ancestor of receiver.propertyAccess.getAncestors()) {
    if (owner && sameNode(ancestor, owner)) break;
    if (Node.isIfStatement(ancestor)) {
      const condition = ancestor.getExpression();
      if (containsPosition(condition, propertyStart) || containsPosition(ancestor.getThenStatement(), propertyStart)) {
        return conditionHasRuntimeKindGuard(condition, receiver.declaration);
      }
    }
    if (Node.isConditionalExpression(ancestor)) {
      const condition = ancestor.getCondition();
      if (containsPosition(condition, propertyStart) || containsPosition(ancestor.getWhenTrue(), propertyStart)) {
        return conditionHasRuntimeKindGuard(condition, receiver.declaration);
      }
    }
  }
  return false;
}

function conditionHasRuntimeKindGuard(
  condition: TsMorphNode,
  declaration: import('ts-morph').VariableDeclaration,
): boolean {
  const candidates = Node.isBinaryExpression(condition)
    ? [condition, ...condition.getDescendantsOfKind(SyntaxKind.BinaryExpression)]
    : condition.getDescendantsOfKind(SyntaxKind.BinaryExpression);
  return candidates.some((binary) => binaryIsRuntimeKindGuard(binary, declaration));
}

function binaryIsRuntimeKindGuard(
  binary: import('ts-morph').BinaryExpression,
  declaration: import('ts-morph').VariableDeclaration,
): boolean {
  const operator = binary.getOperatorToken().getKind();
  if (operator !== SyntaxKind.EqualsEqualsEqualsToken && operator !== SyntaxKind.EqualsEqualsToken) return false;
  const left = unwrapExpression(binary.getLeft());
  const right = unwrapExpression(binary.getRight());
  return (
    (isReceiverKindAccess(left, declaration) && isRuntimeKindLiteral(right)) ||
    (isRuntimeKindLiteral(left) && isReceiverKindAccess(right, declaration))
  );
}

const PARSER_RUNTIME_KIND_GUARDS = new Set(['call', 'ident', 'new']);

function isReceiverKindAccess(
  expression: TsMorphNode | undefined,
  declaration: import('ts-morph').VariableDeclaration,
): boolean {
  if (!expression || !Node.isPropertyAccessExpression(expression)) return false;
  if (expression.getName() !== 'kind') return false;
  const receiver = propertyAccessRootIdentifier(expression);
  return receiver !== undefined && identifierDeclares(receiver, declaration);
}

function isRuntimeKindLiteral(expression: TsMorphNode | undefined): boolean {
  return (
    expression !== undefined &&
    Node.isStringLiteral(expression) &&
    PARSER_RUNTIME_KIND_GUARDS.has(expression.getLiteralText())
  );
}

function containsPosition(node: TsMorphNode, position: number): boolean {
  return node.getStart() <= position && position < node.getEnd();
}

function parseExpressionTypeHasRuntimeBranches(declaration: import('ts-morph').VariableDeclaration): boolean {
  const kinds = discriminantKindValues(declaration.getType(), declaration);
  if (kinds.size === 0) return false;
  return [...kinds].some((kind) => kind !== 'arrayLit' && kind !== 'objectLit');
}

function discriminantKindValues(type: Type, location: TsMorphNode): Set<string> {
  const values = new Set<string>();
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  for (const member of members) {
    const kind = member.getProperty('kind');
    if (!kind) continue;
    const kindType = kind.getTypeAtLocation(location);
    const kindMembers = kindType.isUnion() ? kindType.getUnionTypes() : [kindType];
    for (const kindMember of kindMembers) {
      if (kindMember.isStringLiteral()) values.add(String(kindMember.getLiteralValue()));
    }
  }
  return values;
}

function identifierDeclares(identifier: import('ts-morph').Identifier, declaration: TsMorphNode): boolean {
  return (identifier.getSymbol()?.getDeclarations() ?? []).some((candidate) => sameNode(candidate, declaration));
}

function sameNode(a: TsMorphNode, b: TsMorphNode): boolean {
  return a.getSourceFile().getFilePath() === b.getSourceFile().getFilePath() && a.getStart() === b.getStart();
}

function sameOptionalNode(a: TsMorphNode | undefined, b: TsMorphNode | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameNode(a, b);
}

const FUNCTION_BOUNDARY_KINDS = new Set<SyntaxKind>([
  SyntaxKind.ArrowFunction,
  SyntaxKind.Constructor,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.GetAccessor,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.SetAccessor,
]);

function nearestFunctionBoundary(node: TsMorphNode): TsMorphNode | undefined {
  return node.getAncestors().find((ancestor) => FUNCTION_BOUNDARY_KINDS.has(ancestor.getKind()));
}

function isCallNamed(call: import('ts-morph').CallExpression, name: string): boolean {
  const expression = unwrapExpression(call.getExpression());
  return expression !== undefined && Node.isIdentifier(expression) && expression.getText() === name;
}

function unwrapExpression<T extends TsMorphNode | undefined>(expression: T): T | TsMorphNode | undefined {
  let current: TsMorphNode | undefined = expression;
  while (
    current &&
    (Node.isParenthesizedExpression(current) || Node.isAsExpression(current) || Node.isTypeAssertion(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

function isReviewModeGeneratedFacadeExportCascade(
  sourceFile: import('ts-morph').SourceFile,
  code: number,
  message: string,
  suppressedModuleMisses: Set<string>,
): boolean {
  if (code !== 2305 || suppressedModuleMisses.size === 0) return false;
  const importedModule = extractNoExportModuleSpecifier(message);
  if (!importedModule) return false;

  const candidates = [...sourceFile.getImportDeclarations(), ...sourceFile.getExportDeclarations()].filter(
    (decl) => decl.getModuleSpecifierValue() === importedModule,
  );

  for (const decl of candidates) {
    const facade = decl.getModuleSpecifierSourceFile();
    if (!facade) continue;
    if (hasSuppressedGeneratedStarExport(facade, suppressedModuleMisses)) return true;
  }
  return false;
}

function hasSuppressedGeneratedStarExport(
  facade: import('ts-morph').SourceFile,
  suppressedModuleMisses: Set<string>,
): boolean {
  for (const decl of facade.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (!specifier || decl.getNamedExports().length > 0) continue;
    if (!/^export\s+\*/.test(decl.getText())) continue;
    if (suppressedModuleMisses.has(moduleMissKey(facade.getFilePath(), specifier))) return true;
  }
  return false;
}

function moduleMissKey(filePath: string, specifier: string): string {
  return `${filePath}\0${specifier}`;
}

function extractNoExportModuleSpecifier(message: string): string | undefined {
  const match = message.match(/Module ['"]"?([^'"]+?)"?['"] has no exported member/);
  return match?.[1];
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

// Names provided as globals/lib types by the React-Native/Expo and DOM ambient
// libs — unreachable in kern-guard's sparse clone (no node_modules, and the
// host tsconfig's `lib`/`extends` often doesn't apply). Same class as the
// @types/node globals: the dev's local `tsc` resolves them, review's ad-hoc
// Project can't, so `Cannot find name/namespace 'X'` is environmental noise.
//   __DEV__ — the RN/Expo build-flag global (from `@types/react-native`).
//   HeadersInit / RequestInit / ResponseInit / BodyInit / RequestInfo — DOM
//     lib type aliases devs commonly annotate directly (fetch wrappers).
// Deliberately narrow: only names dev code types directly, so a genuine
// missing-symbol still surfaces.
const WEB_RUNTIME_GLOBAL_NAMES = new Set([
  '__DEV__',
  'HeadersInit',
  'RequestInit',
  'ResponseInit',
  'BodyInit',
  'RequestInfo',
]);

// The RN/Expo/DOM-lib counterpart of isNodeGlobalCannotFindName.
function isWebRuntimeGlobalCannotFindName(message: string): boolean {
  const m = message.match(/^Cannot find (?:name|namespace) '([^']+)'\.?/);
  if (!m) return false;
  return WEB_RUNTIME_GLOBAL_NAMES.has(m[1]);
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
    const canonical = collectCanonicalBuildDiagnosticKeys(filePaths, health);
    if (canonical.attempted && canonical.keys.size === 0) return [];

    const project = createProject(filePaths[0]);
    for (const fp of filePaths) {
      try {
        project.addSourceFileAtPath(fp);
      } catch (_e) {
        void _e; // intentional: skip unreadable/unparseable files
      }
    }
    const findings = runTSCDiagnostics(project);
    return filterToCanonicalBuildDiagnostics(findings, filePaths, health, canonical);
  } catch (err) {
    health?.noteKind('tsc', 'error', 'tsc diagnostics could not build a ts-morph Project', debugDetail(err));
    if (process.env.KERN_DEBUG) console.error('tsc project build error:', (err as Error).message);
    return [];
  }
}

interface CanonicalBuildDiagnosticKeys {
  attempted: boolean;
  keys: Set<string>;
}

function filterToCanonicalBuildDiagnostics(
  findings: ReviewFinding[],
  filePaths: string[],
  health?: ReviewHealthBuilder,
  canonical?: CanonicalBuildDiagnosticKeys,
  cache?: Map<string, Set<string> | undefined>,
): ReviewFinding[] {
  const resolvedCanonical = canonical ?? collectCanonicalBuildDiagnosticKeys(filePaths, health, cache);
  if (!resolvedCanonical.attempted) return findings;
  return findings.filter(
    (finding) => !isSuspectedTsMorphOnlyDiagnostic(finding) || resolvedCanonical.keys.has(tscFindingKey(finding)),
  );
}

function collectCanonicalBuildDiagnosticKeys(
  filePaths: string[],
  health?: ReviewHealthBuilder,
  cache?: Map<string, Set<string> | undefined>,
): CanonicalBuildDiagnosticKeys {
  const tsconfigPaths = new Set<string>();
  for (const filePath of filePaths) {
    if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(filePath) || filePath.endsWith('.d.ts')) continue;
    const tsconfigPath = findTsConfig(dirname(resolve(filePath)));
    if (tsconfigPath) tsconfigPaths.add(resolve(tsconfigPath));
  }

  if (tsconfigPaths.size === 0) return { attempted: false, keys: new Set() };

  const keys = new Set<string>();
  for (const tsconfigPath of tsconfigPaths) {
    const configKeys = cache?.has(tsconfigPath)
      ? cache.get(tsconfigPath)
      : collectCanonicalBuildDiagnosticsForConfig(tsconfigPath, health);
    cache?.set(tsconfigPath, configKeys);
    if (!configKeys) return { attempted: false, keys: new Set() };
    for (const key of configKeys) keys.add(key);
  }

  return { attempted: true, keys };
}

function collectCanonicalBuildDiagnosticsForConfig(
  tsconfigPath: string,
  health?: ReviewHealthBuilder,
): Set<string> | undefined {
  const tscBin = findTscBin(dirname(tsconfigPath));
  if (!tscBin) {
    health?.noteKind('tsc', 'fallback', 'canonical TypeScript comparison skipped because TypeScript was not found');
    return undefined;
  }

  let output = '';
  try {
    execFileSync(
      process.execPath,
      [tscBin, '-p', tsconfigPath, '--noEmit', '--incremental', 'false', '--composite', 'false', '--pretty', 'false'],
      {
        encoding: 'utf-8',
        cwd: dirname(tsconfigPath),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (err) {
    const execErr = err as { stdout?: unknown; stderr?: unknown };
    output = `${typeof execErr.stdout === 'string' ? execErr.stdout : ''}\n${
      typeof execErr.stderr === 'string' ? execErr.stderr : ''
    }`;
  }

  return parseTscBuildDiagnosticKeys(output, dirname(tsconfigPath), health);
}

function tscFindingKey(finding: ReviewFinding): string {
  const code = Number(finding.ruleId.replace(/^ts/, ''));
  return `${normalizeDiagnosticPath(finding.primarySpan.file)}:${code}`;
}

function normalizeDiagnosticPath(filePath: string): string {
  return resolve(filePath).replace(/\\/g, '/');
}

function findTscBin(startDir: string): string | undefined {
  const fromStart = findTscBinFrom(startDir);
  if (fromStart) return fromStart;
  const fromCwd = findTscBinFrom(process.cwd());
  if (fromCwd) return fromCwd;
  try {
    return packageRequire.resolve('typescript/bin/tsc');
  } catch {
    return undefined;
  }
}

function findTscBinFrom(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (let i = 0; i < 20; i++) {
    const candidate = resolve(dir, 'node_modules/typescript/bin/tsc');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function parseTscBuildDiagnosticKeys(
  output: string,
  cwd: string,
  health?: ReviewHealthBuilder,
): Set<string> | undefined {
  const keys = new Set<string>();
  const diagnosticRe = /^(.+?)\(\d+,\d+\):\s+error\s+TS(\d+):/;
  const altDiagnosticRe = /^(.+?):\d+:\d+\s+-\s+error\s+TS(\d+):/;

  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(diagnosticRe) ?? line.match(altDiagnosticRe);
    if (!match) continue;
    const filePath = resolve(cwd, match[1]);
    keys.add(`${normalizeDiagnosticPath(filePath)}:${Number(match[2])}`);
  }

  if (output.trim().length > 0 && keys.size === 0) {
    health?.noteKind('tsc', 'fallback', 'canonical TypeScript output could not be mapped; using ts-morph diagnostics');
    if (process.env.KERN_DEBUG) console.error('unmapped canonical tsc output:', output);
    return undefined;
  }

  return keys;
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
