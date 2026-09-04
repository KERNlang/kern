import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function evaluateLanes({ policy, ciClass, results }) {
  const violations = [];
  const lanes = Array.isArray(policy?.lanes) ? policy.lanes : [];
  if (lanes.length === 0) {
    violations.push('policy declares no lanes');
    return { ok: false, violations };
  }
  const selected = policy?.classes?.[ciClass];
  if (!Array.isArray(selected)) {
    violations.push(`ci class is not declared by the policy: ${ciClass ?? ''}`);
    return { ok: false, violations };
  }
  for (const lane of selected) {
    if (!lanes.includes(lane)) violations.push(`${lane}: selected by ${ciClass} but absent from the lane universe`);
  }
  const reported = results && typeof results === 'object' ? results : {};
  for (const lane of Object.keys(reported)) {
    if (!lanes.includes(lane)) violations.push(`${lane}: reported a result but is not a known lane`);
  }
  const selectedLanes = new Set(selected);
  for (const lane of lanes) {
    const expected = selectedLanes.has(lane) ? 'success' : 'skipped';
    const actual = reported[lane];
    if (typeof actual !== 'string' || actual.length === 0) {
      violations.push(`${lane}: expected ${expected} but no result was reported`);
      continue;
    }
    if (actual !== expected) violations.push(`${lane}: expected ${expected} but got ${actual}`);
  }
  return { ok: violations.length === 0, violations };
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [policyPath, ciClass, resultsJson] = process.argv.slice(2);
  if (!policyPath || !resultsJson) fail('usage: evaluate-ci-lanes.mjs <policy.json> <ci-class> <results-json>');
  let policy;
  let results;
  try {
    policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  } catch (error) {
    fail(`unreadable lane policy ${policyPath}: ${error?.message ?? error}`);
  }
  try {
    results = JSON.parse(resultsJson);
  } catch (error) {
    fail(`unreadable lane results: ${error?.message ?? error}`);
  }
  const { ok, violations } = evaluateLanes({ policy, ciClass, results });
  if (!ok) fail(`CI lanes do not match the ${ciClass} policy:\n${violations.map((line) => `  - ${line}`).join('\n')}`);
  process.stdout.write(`CI lanes match the ${ciClass} policy\n`);
}
