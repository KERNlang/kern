#!/usr/bin/env node
/**
 * Rule-coverage gate.
 *
 * Asserts every rule ID declared in the REGISTRY at
 * packages/review/src/rules/index.ts is referenced by at least one test file
 * under packages/review/tests/ (in any shape — unit test, corpus file,
 * concept test, etc.).
 *
 * Usage:
 *   node scripts/check-rule-coverage.mjs            # strict against allowlist
 *   node scripts/check-rule-coverage.mjs --inventory  # list uncovered, exit 0
 *   node scripts/check-rule-coverage.mjs --update-allowlist  # write the
 *                                                            # current uncovered
 *                                                            # set to disk
 *
 * Allowlist file: scripts/rule-coverage-allowlist.json
 *   { "uncovered": ["rule-id", ...], "note": "..." }
 *
 *   - IDs listed in `uncovered` are tolerated (legacy backlog).
 *   - IDs uncovered but NOT in the allowlist → exit 1 (new rule missing tests).
 *   - IDs in the allowlist that are now covered → exit 1, prompt to refresh.
 *
 * The allowlist is intentionally checked in, not auto-generated, so backfill
 * happens one PR at a time and shrinks the list visibly.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const registryPath = path.join(repoRoot, 'packages/review/src/rules/index.ts');
const testRoots = [
  path.join(repoRoot, 'packages/review/tests'),
  path.join(repoRoot, 'packages/review-mcp/tests'),
];
const allowlistPath = path.join(__dirname, 'rule-coverage-allowlist.json');

const args = new Set(process.argv.slice(2));
const inventoryMode = args.has('--inventory');
const updateAllowlist = args.has('--update-allowlist');

// ── 1. Extract rule IDs from REGISTRY ─────────────────────────────────────
const registrySrc = readFileSync(registryPath, 'utf8');
const registryStart = registrySrc.indexOf('const REGISTRY');
if (registryStart === -1) {
  console.error(`check-rule-coverage: could not locate REGISTRY in ${registryPath}`);
  process.exit(2);
}
const registryBlock = registrySrc.slice(registryStart);
// Catches both the multi-line form (`\n    id: 'foo',`) and the inline form
// (`{ id: 'foo', layer: 'base', ... }`). Single or double quotes accepted.
const idPattern = /\bid:\s*['"]([^'"]+)['"]/g;
const ruleIds = [];
const seen = new Set();
for (const m of registryBlock.matchAll(idPattern)) {
  const id = m[1];
  if (seen.has(id)) continue;
  seen.add(id);
  ruleIds.push(id);
}

if (ruleIds.length === 0) {
  console.error('check-rule-coverage: extracted zero rule IDs — REGISTRY shape changed?');
  process.exit(2);
}

// ── 2. Walk test roots, slurp every file ──────────────────────────────────
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__snapshots__') continue;
      yield* walk(full);
    } else if (st.isFile()) {
      yield full;
    }
  }
}

const testHaystack = [];
for (const root of testRoots) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    try {
      testHaystack.push(readFileSync(file, 'utf8'));
    } catch {
      // skip unreadable
    }
  }
}
const corpus = testHaystack.join('\n');

// ── 3. Decide coverage per rule ID ────────────────────────────────────────
// Coverage signal: the rule ID appears as a quoted string (single, double, or
// backtick) anywhere in a test file's *contents*. This is intentional — a
// quoted occurrence is unlikely to be casual chatter and almost always means
// the rule is being asserted, expected, suppressed, or exercised.
function isCovered(id) {
  // Quoted form ('foo-bar' or "foo-bar") — covers in-test assertions and
  // expected-finding lists.
  if (corpus.includes(`'${id}'`) || corpus.includes(`"${id}"`)) return true;
  // Backtick / template-literal form.
  if (corpus.includes(`\`${id}\``)) return true;
  return false;
}

const uncovered = ruleIds.filter((id) => !isCovered(id));
const covered = ruleIds.filter((id) => isCovered(id));

// ── 4. Inventory mode — print and exit 0 ──────────────────────────────────
if (inventoryMode) {
  console.log(`Rule coverage inventory`);
  console.log(`  Total rules:    ${ruleIds.length}`);
  console.log(`  Covered:        ${covered.length}`);
  console.log(`  Uncovered:      ${uncovered.length}`);
  console.log('');
  if (uncovered.length > 0) {
    console.log('Uncovered rule IDs (no quoted reference in tests/):');
    for (const id of uncovered) console.log(`  - ${id}`);
  } else {
    console.log('All rules have at least one test reference.');
  }
  process.exit(0);
}

// ── 5. Update-allowlist mode — write current uncovered set and exit 0 ─────
if (updateAllowlist) {
  const payload = {
    note:
      'Rule IDs without test coverage. Generated by `node scripts/check-rule-coverage.mjs --update-allowlist`. Shrink this list one PR at a time — never grow it. New rules must come with tests.',
    generated: new Date().toISOString().slice(0, 10),
    uncovered: uncovered.sort(),
  };
  writeFileSync(allowlistPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${uncovered.length} uncovered rule IDs to ${path.relative(repoRoot, allowlistPath)}`);
  process.exit(0);
}

// ── 6. Strict mode — diff against allowlist ───────────────────────────────
let allowlist = new Set();
let allowlistExists = false;
if (existsSync(allowlistPath)) {
  allowlistExists = true;
  try {
    const parsed = JSON.parse(readFileSync(allowlistPath, 'utf8'));
    if (Array.isArray(parsed.uncovered)) {
      allowlist = new Set(parsed.uncovered);
    }
  } catch (err) {
    console.error(`check-rule-coverage: failed to parse ${allowlistPath}: ${err.message}`);
    process.exit(2);
  }
}

const newUncovered = uncovered.filter((id) => !allowlist.has(id));
const staleAllowlist = [...allowlist].filter((id) => !uncovered.includes(id) && ruleIds.includes(id));
const ghostAllowlist = [...allowlist].filter((id) => !ruleIds.includes(id));

console.log(`Rule coverage: ${covered.length}/${ruleIds.length} rules have a test reference.`);
if (allowlistExists) {
  console.log(`Allowlist tolerates ${allowlist.size} legacy uncovered rules.`);
}

let exitCode = 0;

if (newUncovered.length > 0) {
  console.error('');
  console.error(`✗ ${newUncovered.length} rule(s) have no test reference and are not in the allowlist:`);
  for (const id of newUncovered) console.error(`    - ${id}`);
  console.error('');
  console.error('  Add a test that asserts the rule fires (or doesn\'t) on representative code.');
  console.error('  Any quoted reference to the rule ID in packages/review/tests counts.');
  exitCode = 1;
}

if (staleAllowlist.length > 0) {
  console.error('');
  console.error(`✗ ${staleAllowlist.length} rule(s) in the allowlist are now covered. Remove them:`);
  for (const id of staleAllowlist) console.error(`    - ${id}`);
  console.error('');
  console.error(`  Run: node scripts/check-rule-coverage.mjs --update-allowlist`);
  exitCode = 1;
}

if (ghostAllowlist.length > 0) {
  console.error('');
  console.error(`✗ ${ghostAllowlist.length} ID(s) in the allowlist no longer exist in REGISTRY:`);
  for (const id of ghostAllowlist) console.error(`    - ${id}`);
  console.error(`  Run: node scripts/check-rule-coverage.mjs --update-allowlist`);
  exitCode = 1;
}

if (exitCode === 0) {
  console.log('✓ rule-coverage gate passed');
}

process.exit(exitCode);
