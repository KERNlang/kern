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

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const dirArg = args.find((a) => !a.startsWith('--'));
const scanDir = resolve(REPO_ROOT, dirArg ?? 'examples');

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

function astParsePython(source) {
  try {
    execFileSync('python3', ['-c', 'import sys, ast; ast.parse(sys.stdin.read())'], {
      input: source,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stderr: '' };
  } catch (err) {
    const stderr = err && err.stderr ? err.stderr.toString() : String(err.message ?? err);
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
