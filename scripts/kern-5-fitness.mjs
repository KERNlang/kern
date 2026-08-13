#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_PATH = 'scripts/kern-5-fitness-policy.json';
const REMAINING_GATES_PATH = 'scripts/kern-5-remaining-gates-v1.json';
const MATRIX_PATH = 'docs/kern-5-support-matrix.md';
const PACKAGE_PATH = 'package.json';
const GATE_START = '<!-- KERN5_GATE_MATRIX_START -->';
const GATE_END = '<!-- KERN5_GATE_MATRIX_END -->';
const OWNERSHIP_START = '<!-- KERN5_OWNERSHIP_MATRIX_START -->';
const OWNERSHIP_END = '<!-- KERN5_OWNERSHIP_MATRIX_END -->';
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SCRIPT_RE = /^[a-z][a-z0-9:-]{0,127}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const GATE_STATUSES = new Set(['current', 'planned']);
const OWNERSHIP_STATUSES = new Set(['shipped-4.5', 'internal-oracle', 'internal-product', 'not-shipped']);
const M4171_IMPLEMENTATION_SHA = '50407d08ac97eeb4bfe9ee007f1072841b058991';
const PHASE0_BASELINE_SHA = 'bc1682880671b4dcac036ad74be8c4db4987810b';
const CONTRACT_CATEGORIES = [
  'source',
  'diagnostics',
  'trivia',
  'kir',
  'handlers',
  'capabilities',
  'traces',
  'determinism',
  'limits',
  'rejection-behavior',
];
const TERMINAL_GATE_IDS = [
  'kern-checker',
  'kern-formatter',
  'kern-frontend',
  'kern-compiler',
  'selfhost-fixed-point',
  'kern-interpreter-shadow',
  'kern-canonical-cutover',
  'packed-release',
];
const APPROVED_COMPLETION_EVIDENCE = new Set([
  '.Codex/goals/KERN-5-COMPLETION-GOAL.md',
  '.Codex/specs/kern-5-phase1-production-checker/spec.md',
  '.Codex/specs/kern-5-phase1-lossless-formatter/spec.md',
  '.Codex/specs/kern-5-post-m4-171-completion/spec.md',
  'docs/kern-5-release-train.md',
  'docs/kern-5-support-matrix.md',
]);
const DEFAULT_ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function assertText(value, label, maxBytes = 512) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    CONTROL_RE.test(value) ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new Error(`${label} must be non-empty, trimmed, control-free, and at most ${maxBytes} bytes`);
  }
}

function assertId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new Error(`${label} must be a safe kebab-case identifier`);
  }
}

function validateArgv(argv, label) {
  if (!Array.isArray(argv) || argv.length < 2 || argv.length > 4) {
    throw new Error(`${label}.argv must contain 2-4 bounded arguments`);
  }
  for (const [index, value] of argv.entries()) assertText(value, `${label}.argv[${index}]`, 128);
  const isPnpm = argv.length === 2 && argv[0] === 'pnpm' && SCRIPT_RE.test(argv[1]);
  const isDiffCheck = argv.length === 3 && argv[0] === 'git' && argv[1] === 'diff' && argv[2] === '--check';
  if (!isPnpm && !isDiffCheck) {
    throw new Error(`${label}.argv must be pnpm <safe-script> or git diff --check`);
  }
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateKern5RemainingGates(remainingGates) {
  assertRecord(remainingGates, 'KERN 5 remaining-gate ledger');
  assertExactKeys(
    remainingGates,
    ['schemaVersion', 'baseline', 'contractCategories', 'terminalGates'],
    'KERN 5 remaining-gate ledger',
  );
  if (remainingGates.schemaVersion !== 1) {
    throw new Error('KERN 5 remaining-gate ledger schemaVersion must be 1');
  }

  assertRecord(remainingGates.baseline, 'KERN 5 remaining-gate baseline');
  assertExactKeys(remainingGates.baseline, ['originMain', 'm4171Implementation'], 'KERN 5 remaining-gate baseline');
  if (remainingGates.baseline.originMain !== PHASE0_BASELINE_SHA) {
    throw new Error(`KERN 5 remaining-gate originMain must be ${PHASE0_BASELINE_SHA}`);
  }
  if (remainingGates.baseline.m4171Implementation !== M4171_IMPLEMENTATION_SHA) {
    throw new Error(`KERN 5 remaining-gate m4171Implementation must be ${M4171_IMPLEMENTATION_SHA}`);
  }

  if (!Array.isArray(remainingGates.contractCategories)) {
    throw new Error('KERN 5 remaining-gate contractCategories must be an array');
  }
  if (!arraysEqual(remainingGates.contractCategories, CONTRACT_CATEGORIES)) {
    throw new Error(`KERN 5 contract categories must be exactly: ${CONTRACT_CATEGORIES.join(', ')}`);
  }

  if (!Array.isArray(remainingGates.terminalGates)) {
    throw new Error('KERN 5 remaining-gate terminalGates must be an array');
  }
  if (
    !arraysEqual(
      remainingGates.terminalGates.map((gate) => gate?.id),
      TERMINAL_GATE_IDS,
    )
  ) {
    throw new Error(`KERN 5 terminal gates must be exactly: ${TERMINAL_GATE_IDS.join(', ')}`);
  }

  const coveredCategories = new Set();
  for (const [index, gate] of remainingGates.terminalGates.entries()) {
    const label = `terminalGate[${index}]`;
    assertRecord(gate, label);
    assertExactKeys(gate, ['id', 'status', 'argv', 'categories', 'evidence'], label);
    assertId(gate.id, `${label}.id`);
    if (!GATE_STATUSES.has(gate.status)) {
      throw new Error(`Unsupported terminal gate status for ${gate.id}: ${gate.status}`);
    }
    validateArgv(gate.argv, label);

    if (!Array.isArray(gate.categories) || gate.categories.length === 0) {
      throw new Error(`${label}.categories must be a non-empty array`);
    }
    let previousCategoryIndex = -1;
    for (const category of gate.categories) {
      const categoryIndex = CONTRACT_CATEGORIES.indexOf(category);
      if (categoryIndex < 0) throw new Error(`${gate.id} has unknown contract category: ${category}`);
      if (categoryIndex <= previousCategoryIndex) {
        throw new Error(`${gate.id} contract categories must be unique and in global order`);
      }
      previousCategoryIndex = categoryIndex;
      coveredCategories.add(category);
    }

    if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) {
      throw new Error(`${label}.evidence must be a non-empty array`);
    }
    const seenEvidence = new Set();
    for (const evidence of gate.evidence) {
      assertText(evidence, `${label}.evidence`, 256);
      if (!APPROVED_COMPLETION_EVIDENCE.has(evidence)) {
        throw new Error(`${gate.id} has unapproved completion evidence: ${evidence}`);
      }
      if (seenEvidence.has(evidence)) throw new Error(`${gate.id} has duplicate completion evidence: ${evidence}`);
      seenEvidence.add(evidence);
    }
  }
  if (!arraysEqual([...coveredCategories].sort(), [...CONTRACT_CATEGORIES].sort())) {
    throw new Error('KERN 5 terminal gates must cover every contract category');
  }
  return remainingGates;
}

export function validateKern5FitnessPolicy(policy) {
  assertRecord(policy, 'KERN 5 fitness policy');
  assertExactKeys(policy, ['schemaVersion', 'entrypoints', 'gates', 'ownership'], 'KERN 5 fitness policy');
  if (policy.schemaVersion !== 1) throw new Error('KERN 5 fitness policy schemaVersion must be 1');

  assertRecord(policy.entrypoints, 'KERN 5 fitness entrypoints');
  if (Object.keys(policy.entrypoints).length === 0) {
    throw new Error('KERN 5 fitness entrypoints cannot be empty');
  }
  for (const [script, command] of Object.entries(policy.entrypoints)) {
    assertText(script, `entrypoint ${script}`, 128);
    assertText(command, `entrypoint ${script} command`, 512);
  }

  if (!Array.isArray(policy.gates) || policy.gates.length === 0) {
    throw new Error('KERN 5 fitness gates must be a non-empty array');
  }
  const gateIds = new Set();
  let currentGateCount = 0;
  for (const [index, gate] of policy.gates.entries()) {
    const label = `gate[${index}]`;
    assertRecord(gate, label);
    assertExactKeys(gate, ['id', 'label', 'status', 'argv'], label);
    assertId(gate.id, `${label}.id`);
    if (gateIds.has(gate.id)) throw new Error(`Duplicate KERN 5 gate id: ${gate.id}`);
    gateIds.add(gate.id);
    assertText(gate.label, `${label}.label`);
    if (!GATE_STATUSES.has(gate.status)) throw new Error(`Unsupported gate status for ${gate.id}: ${gate.status}`);
    if (gate.status === 'current') currentGateCount += 1;
    validateArgv(gate.argv, label);
  }
  if (currentGateCount === 0) throw new Error('KERN 5 fitness policy must declare at least one current gate');

  if (!Array.isArray(policy.ownership) || policy.ownership.length === 0) {
    throw new Error('KERN 5 ownership rows must be a non-empty array');
  }
  const ownershipIds = new Set();
  for (const [index, row] of policy.ownership.entries()) {
    const label = `ownership[${index}]`;
    assertRecord(row, label);
    assertExactKeys(row, ['id', 'label', 'status', 'evidence'], label);
    assertId(row.id, `${label}.id`);
    if (ownershipIds.has(row.id)) throw new Error(`Duplicate KERN 5 ownership id: ${row.id}`);
    ownershipIds.add(row.id);
    assertText(row.label, `${label}.label`);
    if (!OWNERSHIP_STATUSES.has(row.status)) {
      throw new Error(`Unsupported ownership status for ${row.id}: ${row.status}`);
    }
    assertText(row.evidence, `${label}.evidence`);
  }
  return policy;
}

function extractMarkedTable(markdown, startMarker, endMarker, label) {
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) throw new Error(`Support matrix is missing ${label} markers`);
  if (markdown.indexOf(startMarker, start + startMarker.length) >= 0) {
    throw new Error(`Support matrix contains duplicate ${label} start markers`);
  }
  if (markdown.indexOf(endMarker, end + endMarker.length) >= 0) {
    throw new Error(`Support matrix contains duplicate ${label} end markers`);
  }
  return markdown.slice(start + startMarker.length, end).trim();
}

function parseMarkdownTable(markdown, expectedHeader, label) {
  const lines = markdown
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3 || lines[0] !== expectedHeader || !/^\|(?:\s*:?-+:?\s*\|)+$/u.test(lines[1])) {
    throw new Error(`${label} table header is invalid`);
  }
  return lines.slice(2).map((line, index) => {
    if (!line.startsWith('|') || !line.endsWith('|')) throw new Error(`${label} row ${index + 1} is invalid`);
    return line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim().replace(/^`|`$/gu, ''));
  });
}

function assertRowsEqual(actualRows, expectedRows, label) {
  if (actualRows.length !== expectedRows.length) {
    const actualIds = new Set(actualRows.map((row) => row[0]));
    const expectedIds = new Set(expectedRows.map((row) => row[0]));
    const missing = expectedRows.find((row) => !actualIds.has(row[0]))?.[0];
    const unexpected = actualRows.find((row) => !expectedIds.has(row[0]))?.[0];
    throw new Error(
      `${label} row count mismatch${missing ? `; missing ${missing}` : ''}${unexpected ? `; unexpected ${unexpected}` : ''}`,
    );
  }
  for (let index = 0; index < expectedRows.length; index += 1) {
    const actual = actualRows[index];
    const expected = expectedRows[index];
    if (actual.length !== expected.length || actual.some((cell, cellIndex) => cell !== expected[cellIndex])) {
      throw new Error(`${label} row mismatch for ${expected[0]}`);
    }
  }
}

export function validateKern5FitnessContract({ policy, remainingGates, matrixText, packageJson }) {
  validateKern5FitnessPolicy(policy);
  validateKern5RemainingGates(remainingGates);
  assertRecord(packageJson, 'root package.json');
  assertRecord(packageJson.scripts, 'root package.json scripts');

  for (const [script, command] of Object.entries(policy.entrypoints)) {
    if (packageJson.scripts[script] !== command) {
      throw new Error(`Root script ${script} must exactly match the KERN 5 fitness policy`);
    }
  }

  for (const gate of policy.gates) {
    if (gate.argv[0] !== 'pnpm') continue;
    const exists = typeof packageJson.scripts[gate.argv[1]] === 'string';
    if (gate.status === 'current' && !exists)
      throw new Error(`Current gate ${gate.id} has no root script ${gate.argv[1]}`);
    if (gate.status === 'planned' && exists) {
      throw new Error(
        `Planned gate ${gate.id} already has root script ${gate.argv[1]}; promote its policy and matrix status`,
      );
    }
  }

  const terminalPolicyGates = policy.gates.slice(-TERMINAL_GATE_IDS.length);
  for (const [index, ledgerGate] of remainingGates.terminalGates.entries()) {
    const policyGate = terminalPolicyGates[index];
    if (
      !policyGate ||
      policyGate.id !== ledgerGate.id ||
      policyGate.status !== ledgerGate.status ||
      !arraysEqual(policyGate.argv, ledgerGate.argv)
    ) {
      throw new Error(`KERN 5 policy and completion ledger disagree on terminal gate ${ledgerGate.id}`);
    }
  }

  const gateRows = parseMarkdownTable(
    extractMarkedTable(matrixText, GATE_START, GATE_END, 'gate'),
    '| ID | Gate | Status | Command |',
    'KERN 5 gate',
  );
  const expectedGateRows = policy.gates.map((gate) => [gate.id, gate.label, gate.status, gate.argv.join(' ')]);
  assertRowsEqual(gateRows, expectedGateRows, 'KERN 5 gate');

  const ownershipRows = parseMarkdownTable(
    extractMarkedTable(matrixText, OWNERSHIP_START, OWNERSHIP_END, 'ownership'),
    '| ID | Ownership boundary | Status | Evidence |',
    'KERN 5 ownership',
  );
  const expectedOwnershipRows = policy.ownership.map((row) => [row.id, row.label, row.status, row.evidence]);
  assertRowsEqual(ownershipRows, expectedOwnershipRows, 'KERN 5 ownership');
  return {
    currentGates: policy.gates.filter((gate) => gate.status === 'current'),
    terminalGates: remainingGates.terminalGates,
  };
}

export function loadKern5FitnessContract(rootDir = DEFAULT_ROOT_DIR) {
  const resolvedRoot = path.resolve(rootDir);
  const policy = JSON.parse(readFileSync(path.join(resolvedRoot, POLICY_PATH), 'utf8'));
  const remainingGates = JSON.parse(readFileSync(path.join(resolvedRoot, REMAINING_GATES_PATH), 'utf8'));
  const matrixText = readFileSync(path.join(resolvedRoot, MATRIX_PATH), 'utf8');
  const packageJson = JSON.parse(readFileSync(path.join(resolvedRoot, PACKAGE_PATH), 'utf8'));
  const contract = validateKern5FitnessContract({ policy, remainingGates, matrixText, packageJson });
  for (const evidence of new Set(remainingGates.terminalGates.flatMap((gate) => gate.evidence))) {
    const evidencePath = path.resolve(resolvedRoot, evidence);
    if (!evidencePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`KERN 5 completion evidence escapes the repository root: ${evidence}`);
    }
    readFileSync(evidencePath);
  }
  return contract;
}

export function runKern5Fitness({ currentGates, rootDir = process.cwd(), spawn = spawnSync }) {
  for (const gate of currentGates) {
    console.log(`[fitness:kern-5] ${gate.id}: ${gate.argv.join(' ')}`);
    const result = spawn(gate.argv[0], gate.argv.slice(1), {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `KERN 5 gate ${gate.id} failed with ${result.signal ? `signal ${result.signal}` : `status ${result.status ?? 'unknown'}`}`,
      );
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--check') || args.filter((arg) => arg === '--check').length > 1) {
    throw new Error('Usage: node scripts/kern-5-fitness.mjs [--check]');
  }
  const contract = loadKern5FitnessContract();
  if (args[0] === '--check') {
    console.log('KERN 5 fitness contract passed.');
    return;
  }
  runKern5Fitness(contract);
  console.log('KERN 5 current fitness wall passed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[fitness:kern-5] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
