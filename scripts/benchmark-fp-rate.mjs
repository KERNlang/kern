#!/usr/bin/env node
// Cross-project FP-rate benchmark for the dead-export rule.
//
// Why: kern-lang-landing alone is a sample of 1. To know whether the
// reachability blocker / framework-seed work actually moved FP rate on
// real codebases we need labeled findings from a handful of repos.
//
// What this does:
//   1. Clones (or `git pull`s) each repo in REPOS into .kern/benchmark-cache/
//   2. Runs the kern CLI in --full --json mode against the configured entry
//   3. Extracts dead-export findings
//   4. Auto-labels each finding via a cheap heuristic: if `grep -rl
//      "<symbolName>"` over the repo (excluding the source file) returns
//      no hits, mark "auto-TP" (genuinely dead). Otherwise "needs-review"
//      — a human still has to confirm whether matches are real or noise.
//   5. Writes:
//        .kern/benchmark-results.json     — raw + labeled, machine-readable
//        .kern/benchmark-results.md       — human review template
//
// What this does NOT do:
//   - Persist to ~/.claude/flow_stats.db. The schema is /flow-report's
//     concern; export from the JSON when needed.
//   - Make any judgment call on "needs-review" findings. That's the
//     human's job; the script reduces the burden by short-listing the
//     obvious TPs.
//
// Usage:
//   node scripts/benchmark-fp-rate.mjs            # run all repos
//   node scripts/benchmark-fp-rate.mjs --only foo # run a single repo by name
//
// Add a repo: append to REPOS below. Pick ones with a stable tsconfig and
// a clear App Router or Pages Router entry — the seed coverage Phase 4
// targeted is Next.js, so other frameworks will under-report public-API.

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CACHE_DIR = join(REPO_ROOT, '.kern', 'benchmark-cache');
const RESULTS_JSON = join(REPO_ROOT, '.kern', 'benchmark-results.json');
const RESULTS_MD = join(REPO_ROOT, '.kern', 'benchmark-results.md');
const CLI = join(REPO_ROOT, 'packages', 'cli', 'dist', 'cli.js');

/**
 * Repo list. Each entry:
 *   name        — short identifier used in cache-dir + result keys
 *   url         — git clone URL (https form preferred; ssh works too)
 *   ref         — optional branch/tag/SHA. Defaults to default branch.
 *   entryPath   — path INSIDE the cloned repo to point review at
 *                 (typically `app` for App Router, `src` for Pages
 *                 Router or src-layout). Required.
 *   note        — free-text context for the review template.
 *
 * To add a repo, append a new object. Keep the list short — five
 * substantive repos beat fifty toy examples for FP-rate signal.
 */
const REPOS = [
  {
    name: 'kern-lang-landing',
    url: null, // local-only; resolved below
    localPath: resolve(REPO_ROOT, '..', 'kern-lang-landing'),
    entryPath: 'app',
    note: 'Control sample — Next.js 15 App Router, ~105 .ts/.tsx files.',
  },
  // {
  //   name: 'vercel-commerce',
  //   url: 'https://github.com/vercel/commerce.git',
  //   ref: 'main',
  //   entryPath: 'app',
  //   note: 'Real e-commerce app, App Router. Heavy use of server actions.',
  // },
  // {
  //   name: 'shadcn-taxonomy',
  //   url: 'https://github.com/shadcn/taxonomy.git',
  //   ref: 'main',
  //   entryPath: 'app',
  //   note: 'shadcn taxonomy starter — App Router, dashboards, auth.',
  // },
];

const ARGS = process.argv.slice(2);
const ONLY_FLAG_IDX = ARGS.indexOf('--only');
const ONLY = ONLY_FLAG_IDX >= 0 ? ARGS[ONLY_FLAG_IDX + 1] : undefined;

function log(msg) {
  process.stderr.write(`[benchmark] ${msg}\n`);
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function ensureRepo(repo) {
  if (repo.localPath) {
    if (!existsSync(repo.localPath)) {
      throw new Error(`Local repo ${repo.name} not found at ${repo.localPath}`);
    }
    return repo.localPath;
  }
  const target = join(CACHE_DIR, repo.name);
  if (!existsSync(target)) {
    log(`cloning ${repo.url} → ${target}`);
    execFileSync('git', ['clone', '--depth', '1', repo.url, target], { stdio: 'inherit' });
    if (repo.ref) {
      execFileSync('git', ['-C', target, 'checkout', repo.ref], { stdio: 'inherit' });
    }
  } else {
    log(`updating ${repo.name}`);
    try {
      execFileSync('git', ['-C', target, 'pull', '--ff-only'], { stdio: 'inherit' });
    } catch {
      log(`  (pull failed; using cached state for ${repo.name})`);
    }
  }
  return target;
}

function runReview(repoPath, entryPath) {
  const reviewTarget = join(repoPath, entryPath);
  if (!existsSync(reviewTarget)) {
    throw new Error(`entry path ${reviewTarget} does not exist`);
  }
  // --full implies --recursive --graph (kern-lang dev branch as of 2026-04).
  // --json prints a machine-readable report; suppress text output noise.
  // Capture to a temp file via shell redirection. execFileSync's stdio:'pipe'
  // truncates large outputs (~64KB) on macOS even with maxBuffer raised —
  // the kern review payload on a real Next.js app is multi-MB so we need
  // file capture, not in-memory pipe.
  const tmpFile = join(tmpdir(), `kern-bench-${Date.now()}-${process.pid}.json`);
  try {
    execSync(`node ${JSON.stringify(CLI)} review ${JSON.stringify(reviewTarget)} --full --json > ${JSON.stringify(tmpFile)}`, {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const out = readFileSync(tmpFile, 'utf8');
    // The CLI prepends a one-line banner ("Graph: N files resolved ...") to
    // stdout before the JSON payload. Strip everything before the first `[`
    // or `{`. Subsequent occurrences of "Graph" are inside JSON string values
    // (e.g., the `confidenceGraph` field name) — JSON.parse handles those.
    const firstBracket = out.indexOf('[');
    const firstBrace = out.indexOf('{');
    const start =
      firstBracket === -1 ? firstBrace : firstBrace === -1 ? firstBracket : Math.min(firstBracket, firstBrace);
    if (start < 0) {
      throw new Error(`no JSON payload in CLI output for ${repoPath}`);
    }
    return JSON.parse(out.slice(start));
  } catch (err) {
    throw new Error(`failed to capture/parse JSON output for ${repoPath}: ${err.message}`);
  } finally {
    try {
      rmSync(tmpFile, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

function extractDeadExports(reviewReport) {
  // The CLI's --json shape is { reports: [...] } where each report has
  // findings: [...]. Older shapes ship as a flat array. Handle both.
  const reports = Array.isArray(reviewReport) ? reviewReport : (reviewReport.reports ?? []);
  const out = [];
  for (const report of reports) {
    for (const f of report.findings ?? []) {
      if (f.ruleId === 'dead-export') {
        out.push({
          filePath: report.filePath,
          line: f.primarySpan?.startLine ?? 0,
          message: f.message,
          severity: f.severity,
          confidence: f.confidence,
          // Symbol name is in the message: `Exported function 'X' is never...`
          symbolName: extractSymbol(f.message),
        });
      }
    }
  }
  return out;
}

function extractSymbol(message) {
  const m = message.match(/'([^']+)'/);
  return m ? m[1] : '';
}

function autoLabel(repoPath, finding) {
  if (!finding.symbolName) return 'needs-review';
  // Cheap heuristic — `grep -rl "<symbolName>"` excluding the source file
  // and excluding common build-artifact dirs. Zero hits ⇒ auto-TP.
  // Using execSync because grep is line-buffered and we want exit-code
  // semantics for the "no matches" case (exit 1 from grep).
  try {
    const cmd = `grep -rl --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --exclude-dir=out -F ${JSON.stringify(finding.symbolName)} ${JSON.stringify(repoPath)} | grep -v ${JSON.stringify(finding.filePath)}`;
    const matches = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .split('\n')
      .filter(Boolean);
    return matches.length === 0 ? 'auto-TP' : 'needs-review';
  } catch {
    // grep exits 1 when no matches found — that's our auto-TP signal.
    return 'auto-TP';
  }
}

function writeJson(results) {
  mkdirSync(dirname(RESULTS_JSON), { recursive: true });
  writeFileSync(RESULTS_JSON, `${JSON.stringify(results, null, 2)}\n`);
  log(`wrote ${RESULTS_JSON}`);
}

function writeMarkdown(results) {
  const lines = [];
  lines.push('# Cross-project FP-rate benchmark', '');
  lines.push(`Generated: ${new Date().toISOString()}`, '');
  lines.push(
    '`auto-TP` findings have **no** other file in the repo containing the symbol name (heuristic). `needs-review` findings need a human to decide whether the cross-file match is a real reference, a comment, or coincidence.',
    '',
  );
  for (const repo of results.repos) {
    lines.push(`## ${repo.name}`, '');
    lines.push(`${repo.note}`, '');
    lines.push(`Total dead-export findings: **${repo.findings.length}**`, '');
    lines.push(`- auto-TP: ${repo.findings.filter((f) => f.label === 'auto-TP').length}`);
    lines.push(`- needs-review: ${repo.findings.filter((f) => f.label === 'needs-review').length}`, '');
    if (repo.findings.length > 0) {
      lines.push('| label | symbol | file | line |');
      lines.push('|---|---|---|---|');
      for (const f of repo.findings) {
        lines.push(`| ${f.label} | \`${f.symbolName}\` | \`${f.filePath}\` | ${f.line} |`);
      }
      lines.push('');
    }
  }
  mkdirSync(dirname(RESULTS_MD), { recursive: true });
  writeFileSync(RESULTS_MD, `${lines.join('\n')}\n`);
  log(`wrote ${RESULTS_MD}`);
}

function main() {
  ensureCacheDir();
  const targets = ONLY ? REPOS.filter((r) => r.name === ONLY) : REPOS;
  if (targets.length === 0) {
    log(`no repos matched (only=${ONLY ?? '<all>'}). Available: ${REPOS.map((r) => r.name).join(', ')}`);
    process.exit(1);
  }
  const results = { generatedAt: new Date().toISOString(), repos: [] };
  for (const repo of targets) {
    log(`=== ${repo.name} ===`);
    const repoPath = ensureRepo(repo);
    const review = runReview(repoPath, repo.entryPath);
    const findings = extractDeadExports(review);
    const labeled = findings.map((f) => ({ ...f, label: autoLabel(repoPath, f) }));
    results.repos.push({ name: repo.name, note: repo.note, findings: labeled });
    log(
      `  ${labeled.length} dead-export findings; ${labeled.filter((f) => f.label === 'auto-TP').length} auto-TP, ${labeled.filter((f) => f.label === 'needs-review').length} needs-review`,
    );
  }
  writeJson(results);
  writeMarkdown(results);
  log('done');
}

main();
