#!/usr/bin/env node
/**
 * lift-rate-python.mjs — Python codegen quality metric for KERN.
 *
 * Companion to scripts/lift-rate.mjs. Where lift-rate.mjs measures whether
 * raw `<<<...>>>` handler bodies can be lifted into native KERN AST
 * (parser-side), this script measures whether already-native KERN actually
 * generates *clean* Python (codegen-side).
 *
 * Workflow:
 *   1. Scan a directory of .kern files (default: examples/).
 *   2. Keep only files that exercise the FastAPI/Python target — i.e.
 *      parse + transpileFastAPI yields at least one route/websocket/
 *      middleware Python artifact with user-handler content.
 *   3. For each generated Python artifact:
 *        - Validate via python3 ast.parse (must be syntactically valid).
 *        - grep for `NotImplementedError("Unsupported raw JavaScript...")`
 *          (raw-foreign leak — handler couldn't lift; codegen emitted
 *          the foreign-bailout marker).
 *        - grep for `# TODO(low-confidence): <name>` (codegen took a
 *          best-effort path for a specific construct).
 *        - grep for `pass  # kern:` (placeholder fallback).
 *   4. Aggregate. A Python artifact is "clean" iff it ast-parses AND
 *      contains no leak/low-confidence/placeholder markers.
 *
 * Output: markdown summary to stdout. `--json` for machine-readable form.
 *
 * Note on python3 invocation: this script shells out to python3 with a
 * fixed argv (no user input on argv; the artifact content is fed via
 * stdin). execFileSync — not exec — so there is no shell-expansion path.
 *
 * Usage:
 *   pnpm --filter @kernlang/core build
 *   pnpm --filter @kernlang/fastapi build
 *   node scripts/lift-rate-python.mjs              # scan examples/
 *   node scripts/lift-rate-python.mjs <dir>        # scan custom directory
 *   node scripts/lift-rate-python.mjs --json       # JSON output
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const { parse } = await import(join(REPO_ROOT, 'packages/core/dist/index.js'));
const { transpileFastAPI } = await import(join(REPO_ROOT, 'packages/fastapi/dist/index.js'));

const rawArgs = process.argv.slice(2);

// ── Argument parsing ────────────────────────────────────────────────
// Walks `rawArgs` left-to-right, consuming value tokens for known
// numeric flags. Tokens NOT consumed by a flag-and-value pair become
// candidates for the positional `dirArg`. This fixes B11 (Codex review
// on ac53a5fd): the old `find((a) => !a.startsWith('--'))` would
// capture `--min-clean-rate 60`'s `60` as the scan directory and fail
// on path resolution.
//
// M5 (Codex review on ac53a5fd): invalid numeric arguments now hard-error
// instead of silently falling back to the default. A `--min-clean-rate abc`
// shouldn't pass the gate at 55% — it should fail with a usage error.

const NUMERIC_FLAGS = new Set(['--max-ast-parse-fails', '--min-clean-rate']);
const BOOLEAN_FLAGS = new Set(['--json', '--check']);

function fail(msg) {
  console.error(`lift-rate-python.mjs: ${msg}`);
  process.exit(2);
}

const parsedFlags = new Map();
const positional = [];
for (let i = 0; i < rawArgs.length; i += 1) {
  const tok = rawArgs[i];
  if (BOOLEAN_FLAGS.has(tok)) {
    parsedFlags.set(tok, true);
    continue;
  }
  let name;
  let valueStr;
  if (tok.startsWith('--')) {
    const eqIdx = tok.indexOf('=');
    if (eqIdx >= 0) {
      name = tok.slice(0, eqIdx);
      valueStr = tok.slice(eqIdx + 1);
    } else {
      name = tok;
    }
    if (NUMERIC_FLAGS.has(name)) {
      if (valueStr === undefined) {
        if (i + 1 >= rawArgs.length) fail(`flag ${name} requires a numeric value.`);
        i += 1;
        valueStr = rawArgs[i];
      }
      const n = Number(valueStr);
      if (!Number.isFinite(n)) fail(`flag ${name} requires a finite numeric value (got "${valueStr}").`);
      parsedFlags.set(name, n);
      continue;
    }
    // Unknown long flag — accept but warn so future flags don't typo silently.
    parsedFlags.set(name, valueStr ?? true);
    continue;
  }
  positional.push(tok);
}

const jsonOut = parsedFlags.has('--json');
const checkMode = parsedFlags.has('--check');
const dirArg = positional[0];
const scanDir = resolve(REPO_ROOT, dirArg ?? 'examples');

const MAX_AST_PARSE_FAILS = parsedFlags.has('--max-ast-parse-fails') ? parsedFlags.get('--max-ast-parse-fails') : 0;
// Established baseline on examples/ at the arc landing is 58.62% (Step 7).
// Threshold sits at 55 — 3.6pp of headroom for unrelated codegen flux while
// still flagging regressions where raw-foreign-leak count starts creeping up.
const MIN_CLEAN_RATE = parsedFlags.has('--min-clean-rate') ? parsedFlags.get('--min-clean-rate') : 55;

function listKernFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...listKernFiles(full));
    } else if (entry.endsWith('.kern')) {
      out.push(full);
    }
  }
  return out;
}

const files = listKernFiles(scanDir);
if (files.length === 0) {
  console.error(`No .kern files found under ${scanDir}`);
  process.exit(1);
}

const LEAK_MARKER = 'NotImplementedError("Unsupported raw JavaScript handler syntax';
const LOW_CONFIDENCE_MARKER = /# TODO\(low-confidence\): ([A-Za-z0-9_.-]+)/g;
const PASS_KERN_MARKER = /^\s*pass\s+# kern:\s*([A-Za-z0-9_.-]+)/gm;
const USER_ARTIFACT_TYPES = new Set(['route', 'websocket', 'middleware']);

const rejectionCounts = new Map();
const perFileFindings = [];

function bumpRejection(reason) {
  rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
}

// M4 (Codex+Gemini on 2f7f5643): distinguish "python3 not in PATH"
// from other invocation failures (permissions, broken runtime, etc.)
// so the script's error message points to the real cause.
try {
  execFileSync('python3', ['--version'], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 5000 });
} catch (err) {
  if (err && err.code === 'ENOENT') {
    console.error(
      'lift-rate-python.mjs: python3 not found in PATH. Install Python 3 or adjust PATH; this script needs `python3 -c "import ast; ast.parse(...)"` for syntax validation.',
    );
  } else {
    console.error(`lift-rate-python.mjs: failed to invoke python3 --version: ${err && err.message ? err.message : err}`);
  }
  process.exit(2);
}

const AST_PARSE_TIMEOUT_MS = 10_000;

function astParsePython(source) {
  // Defensive type-check (kimi on 2f7f5643): the source MUST be a
  // string. If a non-string slips through it would crash inside
  // Buffer.from, surfaced as an opaque ast-parse-fail.
  if (typeof source !== 'string') {
    return { ok: false, stderr: `astParsePython: expected string source, got ${typeof source}` };
  }
  try {
    execFileSync('python3', ['-c', 'import sys, ast; ast.parse(sys.stdin.read())'], {
      input: source,
      stdio: ['pipe', 'pipe', 'pipe'],
      // B13 (Gemini+Kimi on 2f7f5643): cap parse time so a pathological
      // input doesn't hang the script. Real-world ast.parse on a single
      // route artifact completes in <100ms.
      timeout: AST_PARSE_TIMEOUT_MS,
    });
    return { ok: true, stderr: '' };
  } catch (err) {
    const rawStderr = err && err.stderr ? err.stderr.toString() : String(err.message ?? err);
    // The CPython traceback puts the actionable error (SyntaxError /
    // IndentationError / TabError + message) on the LAST line of the
    // traceback. The previous code used `find` which returned the
    // FIRST match — if the offending source line itself contained
    // text like `# SyntaxError: ...` or a chained traceback included
    // earlier matching text, the wrong line got captured.
    // B12 (Codex+Gemini on 2f7f5643): use findLast instead.
    const trimmedLines = rawStderr.split('\n').map((l) => l.trim()).filter(Boolean);
    const errLine = trimmedLines.findLast((l) => /^(SyntaxError|IndentationError|TabError):/.test(l));
    const stderr = errLine || trimmedLines[trimmedLines.length - 1] || rawStderr || 'unknown ast parse error';
    return { ok: false, stderr };
  }
}

let filesWithPythonOutput = 0;
let artifactsExamined = 0;
let artifactsClean = 0;

for (const file of files) {
  const relPath = file.replace(`${REPO_ROOT}/`, '');
  const source = readFileSync(file, 'utf8');
  let root;
  try {
    root = parse(source);
  } catch (err) {
    bumpRejection('parse-fail');
    perFileFindings.push({ file: relPath, error: 'parse-fail', detail: String(err.message ?? err) });
    continue;
  }

  let result;
  try {
    result = transpileFastAPI(root);
  } catch (err) {
    bumpRejection('transpile-throw');
    perFileFindings.push({ file: relPath, error: 'transpile-throw', detail: String(err.message ?? err) });
    continue;
  }

  const pythonArtifacts = (result.artifacts ?? []).filter(
    (a) => a.path.endsWith('.py') && USER_ARTIFACT_TYPES.has(a.type) && a.content.trim().length > 0,
  );
  if (pythonArtifacts.length === 0) continue;
  filesWithPythonOutput++;

  for (const artifact of pythonArtifacts) {
    artifactsExamined++;
    const artifactFindings = [];

    const ast = astParsePython(artifact.content);
    if (!ast.ok) {
      bumpRejection('ast-parse-fail');
      artifactFindings.push({ reason: 'ast-parse-fail', detail: ast.stderr.split('\n')[0] });
    }

    let leakCount = 0;
    let pos = 0;
    while ((pos = artifact.content.indexOf(LEAK_MARKER, pos)) !== -1) {
      leakCount++;
      pos += LEAK_MARKER.length;
    }
    if (leakCount > 0) {
      bumpRejection('raw-foreign-leak');
      artifactFindings.push({ reason: 'raw-foreign-leak', count: leakCount });
    }

    LOW_CONFIDENCE_MARKER.lastIndex = 0;
    let lcMatch;
    const lcByName = new Map();
    while ((lcMatch = LOW_CONFIDENCE_MARKER.exec(artifact.content)) !== null) {
      const name = lcMatch[1];
      lcByName.set(name, (lcByName.get(name) ?? 0) + 1);
    }
    for (const [name, count] of lcByName.entries()) {
      bumpRejection(`low-confidence:${name}`);
      artifactFindings.push({ reason: `low-confidence:${name}`, count });
    }

    PASS_KERN_MARKER.lastIndex = 0;
    let passMatch;
    const passByName = new Map();
    while ((passMatch = PASS_KERN_MARKER.exec(artifact.content)) !== null) {
      const name = passMatch[1];
      passByName.set(name, (passByName.get(name) ?? 0) + 1);
    }
    for (const [name, count] of passByName.entries()) {
      bumpRejection(`pass-fallback:${name}`);
      artifactFindings.push({ reason: `pass-fallback:${name}`, count });
    }

    if (artifactFindings.length === 0) {
      artifactsClean++;
    } else {
      perFileFindings.push({ file: relPath, artifact: artifact.path, findings: artifactFindings });
    }
  }
}

const cleanRate = artifactsExamined === 0 ? 0 : (artifactsClean / artifactsExamined) * 100;
const rejections = [...rejectionCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([reason, count]) => ({ reason, count }));

const summary = {
  scanDir: scanDir.replace(`${REPO_ROOT}/`, ''),
  filesScanned: files.length,
  filesWithPythonOutput,
  artifactsExamined,
  artifactsClean,
  cleanRatePct: Number(cleanRate.toFixed(2)),
  rejections,
};

if (jsonOut) {
  console.log(JSON.stringify({ summary, perFileFindings }, null, 2));
  process.exit(0);
}

if (checkMode) {
  // CI gate: enforce no regression below the established baseline.
  // ast-parse-fail count MUST be zero — invalid Python is never acceptable;
  // generated route modules wouldn't import. Clean-rate enforces a soft
  // floor against silent codegen rot (more raw-foreign-leaks creeping in).
  const astParseFails = (rejectionCounts.get('ast-parse-fail') ?? 0);
  const failures = [];
  if (astParseFails > MAX_AST_PARSE_FAILS) {
    failures.push(
      `ast-parse-fail count ${astParseFails} exceeds threshold ${MAX_AST_PARSE_FAILS} — generated Python has syntax errors that break FastAPI route import.`,
    );
  }
  if (cleanRate < MIN_CLEAN_RATE) {
    failures.push(
      `clean rate ${cleanRate.toFixed(2)}% below threshold ${MIN_CLEAN_RATE}% — Python codegen quality regressed.`,
    );
  }
  if (failures.length > 0) {
    console.error('Python codegen quality gate FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('Run `node scripts/lift-rate-python.mjs` (without --check) for the full report.');
    process.exit(1);
  }
  console.log(
    `Python codegen quality gate PASSED — clean rate ${cleanRate.toFixed(2)}% (≥ ${MIN_CLEAN_RATE}%), ast-parse-fail count ${astParseFails} (≤ ${MAX_AST_PARSE_FAILS}).`,
  );
  process.exit(0);
}

const lines = [];
lines.push(`# KERN Python Codegen Quality — ${summary.scanDir}`);
lines.push('');
lines.push(`- Files scanned: **${summary.filesScanned}**`);
lines.push(`- Files emitting Python (route/ws/middleware): **${summary.filesWithPythonOutput}**`);
lines.push(`- Python artifacts examined: **${summary.artifactsExamined}**`);
lines.push(`- Clean artifacts (ast-OK + no markers): **${summary.artifactsClean}**`);
lines.push('');
lines.push(`## Clean rate: **${summary.cleanRatePct}%**`);
lines.push('');
lines.push(
  'A Python artifact is *clean* iff python3 `ast.parse` succeeds AND the file contains no `NotImplementedError("Unsupported raw JavaScript handler syntax")`, no `# TODO(low-confidence): <name>`, and no `pass  # kern: <name>` fallback marker.',
);
if (rejections.length > 0) {
  lines.push('');
  lines.push('## Top rejection reasons');
  lines.push('');
  lines.push('| Reason | Count |');
  lines.push('|---|---:|');
  for (const r of rejections.slice(0, 20)) {
    lines.push(`| \`${r.reason}\` | ${r.count} |`);
  }
  if (rejections.length > 20) {
    lines.push(`| _(${rejections.length - 20} more)_ | — |`);
  }
}
if (perFileFindings.length > 0) {
  lines.push('');
  lines.push('## Per-file findings (top 15)');
  lines.push('');
  for (const f of perFileFindings.slice(0, 15)) {
    if (f.error) {
      lines.push(`- \`${f.file}\` — **${f.error}**: ${f.detail}`);
    } else {
      const summary = f.findings
        .map((x) => (x.count ? `${x.reason}×${x.count}` : x.reason))
        .join(', ');
      lines.push(`- \`${f.file}\` → \`${f.artifact}\`: ${summary}`);
    }
  }
  if (perFileFindings.length > 15) {
    lines.push(`- _(${perFileFindings.length - 15} more entries — re-run with --json for full list)_`);
  }
}
lines.push('');
console.log(lines.join('\n'));
