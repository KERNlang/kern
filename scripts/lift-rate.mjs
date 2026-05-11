#!/usr/bin/env node
/**
 * lift-rate.mjs — Empirical lift-rate measurement for KERN handler bodies.
 *
 * Scans a directory of .kern files, classifies every raw handler body via
 * the same AST walker the migrator uses (`classifyHandlerBody` → slice α-3),
 * and reports:
 *
 *   - totalHandlers      — bodies with `code` content (non-empty)
 *   - eligibleHandlers   — bodies that `kern migrate native-handlers` can lift
 *   - excludedHandlers   — deliberate foreign/template bodies, not ordinary gaps
 *   - liftRate           — eligible / total, as percent (raw lift rate)
 *   - actionableLiftRate — eligible / (total - excluded), as percent
 *   - rejections         — top actionable reasons bodies fall through
 *
 * Why: every lift slice ("template literals", "let-destructure", "cell")
 * claims to "lift more code", but without an aggregate metric the claim is
 * vibes. This script gives us a single number that moves when a slice ships,
 * and surfaces the next-highest-leverage rejection bucket to tackle.
 *
 * Output: prints a markdown report to stdout. `--json` flag emits JSON.
 *
 * Usage:
 *   pnpm --filter @kernlang/core build       # script reads from dist/
 *   node scripts/lift-rate.mjs                # scan examples/ (default)
 *   node scripts/lift-rate.mjs path/to/dir    # scan a custom directory
 *   node scripts/lift-rate.mjs --json         # JSON output
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const { scanFileForEligibility } = await import(join(REPO_ROOT, 'packages/core/dist/native-eligibility.js'));

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const dirArg = args.find((a) => !a.startsWith('--'));
const scanDir = resolve(REPO_ROOT, dirArg ?? 'examples');

function listKernFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listKernFiles(full));
    else if (entry.endsWith('.kern')) out.push(full);
  }
  return out;
}

const files = listKernFiles(scanDir);
if (files.length === 0) {
  console.error(`No .kern files found under ${scanDir}`);
  process.exit(1);
}

let totalHandlers = 0;
let eligibleHandlers = 0;
let excludedHandlers = 0;
let emptyHandlers = 0;
const rejectionCounts = new Map();
const excludedCounts = new Map();
const fileReports = [];

const EXCLUDED_REASONS = new Set(['foreign-by-design', 'template-placeholder']);

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  const report = scanFileForEligibility(content);
  fileReports.push({ file: file.replace(REPO_ROOT + '/', ''), report });
  for (const body of report.bodies) {
    if (body.text.trim().length === 0) {
      emptyHandlers++;
      continue;
    }
    totalHandlers++;
    if (body.eligible) {
      eligibleHandlers++;
    } else if (EXCLUDED_REASONS.has(body.reason)) {
      excludedHandlers++;
      excludedCounts.set(body.reason, (excludedCounts.get(body.reason) ?? 0) + 1);
    } else {
      rejectionCounts.set(body.reason, (rejectionCounts.get(body.reason) ?? 0) + 1);
    }
  }
}

const liftRate = totalHandlers === 0 ? 0 : (eligibleHandlers / totalHandlers) * 100;
const actionableTotal = totalHandlers - excludedHandlers;
const actionableLiftRate = actionableTotal === 0 ? null : (eligibleHandlers / actionableTotal) * 100;
const actionableRejected = actionableTotal - eligibleHandlers;
const rejections = [...rejectionCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([reason, count]) => ({
    reason,
    count,
    pctOfTotal: totalHandlers === 0 ? 0 : (count / totalHandlers) * 100,
    pctOfRejections: actionableRejected === 0 ? 0 : (count / actionableRejected) * 100,
  }));
const exclusions = [...excludedCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([reason, count]) => ({
    reason,
    count,
    pctOfTotal: totalHandlers === 0 ? 0 : (count / totalHandlers) * 100,
  }));

const summary = {
  scanDir: scanDir.replace(REPO_ROOT + '/', ''),
  filesScanned: files.length,
  emptyHandlers,
  totalHandlers,
  eligibleHandlers,
  excludedHandlers,
  actionableHandlers: actionableTotal,
  ineligibleHandlers: actionableRejected,
  liftRatePct: Number(liftRate.toFixed(2)),
  actionableLiftRatePct: actionableLiftRate === null ? null : Number(actionableLiftRate.toFixed(2)),
  exclusions,
  rejections,
};

if (jsonOut) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const lines = [];
lines.push(`# KERN Lift Rate — ${summary.scanDir}`);
lines.push('');
lines.push(`- Files scanned: **${summary.filesScanned}**`);
lines.push(`- Total handler bodies (non-empty): **${summary.totalHandlers}**`);
lines.push(`- Eligible for migration: **${summary.eligibleHandlers}**`);
lines.push(`- Excluded as foreign/template: **${summary.excludedHandlers}**`);
lines.push(`- Actionable language-gap handlers: **${summary.actionableHandlers}**`);
lines.push(`- Ineligible actionable handlers: **${summary.ineligibleHandlers}**`);
lines.push(`- Empty (whitespace-only) bodies skipped: ${summary.emptyHandlers}`);
lines.push('');
lines.push(`## Lift rate: **${summary.liftRatePct}%**`);
lines.push(
  `## Actionable lift rate: **${summary.actionableLiftRatePct === null ? 'N/A' : `${summary.actionableLiftRatePct}%`}**`,
);
lines.push('');
lines.push(
  `(raw: eligibleHandlers / totalHandlers; actionable: eligibleHandlers / (totalHandlers - foreign/template exclusions))`,
);
if (exclusions.length > 0) {
  lines.push('');
  lines.push('## Excluded foreign/template reasons');
  lines.push('');
  lines.push('| Reason | Count | % of total |');
  lines.push('|---|---:|---:|');
  for (const r of exclusions) {
    lines.push(`| \`${r.reason}\` | ${r.count} | ${r.pctOfTotal.toFixed(1)}% |`);
  }
}
lines.push('');
lines.push('## Top actionable rejection reasons');
lines.push('');
lines.push('| Reason | Count | % of total | % of rejections |');
lines.push('|---|---:|---:|---:|');
const top = rejections.slice(0, 15);
for (const r of top) {
  lines.push(`| \`${r.reason}\` | ${r.count} | ${r.pctOfTotal.toFixed(1)}% | ${r.pctOfRejections.toFixed(1)}% |`);
}
if (rejections.length > 15) {
  const tail = rejections.slice(15);
  const tailTotal = tail.reduce((s, r) => s + r.count, 0);
  lines.push(`| _(${tail.length} more)_ | ${tailTotal} | — | — |`);
}
lines.push('');
console.log(lines.join('\n'));
