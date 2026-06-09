/**
 * Coercion differential conformance — KERN single-source value→string parity.
 *
 * KERN is one language emitted to BOTH TypeScript and Python; the contract is
 * parity by construction. JS coerces values to strings with well-known rules
 * (`true`→"true", `null`→"null", `undefined`→"undefined", `1.0`→"1",
 * `[1,2,3]`→"1,2,3", `"a"+true`→"atrue") that Python's `str()`/`+` do NOT match
 * (`True`/`None`/`1.0`/`[1, 2, 3]`/TypeError). Implicit coercion sites —
 * template interpolation `${x}` and string `+` concatenation — must therefore
 * be lowered to JS semantics on the Python target (TS already IS JS).
 *
 * Each fixture is a zero-arg `fn probe` whose return value exercises one
 * coercion. The module is compiled through BOTH codegen paths (core → TS,
 * python → pure Python), each driver calls `probe()` and prints its
 * JSON-normalized return, and we assert ts == python == expected. Expected
 * values are JS/TS truth, so the oracle is correct by construction.
 *
 * Discrimination: most fixtures are RED at base (Python diverges) and force the
 * implementation. Four are GREEN guards that must STAY green — `2 + 3 == 5`
 * catches an additive `+` that over-coerces to string concat, and the `??`
 * fixtures (notably `undefined ?? 9 == 9`) catch an `undefined` representation
 * that stops being nullish. A half-built fix turns a guard RED.
 *
 * Run:  node scripts/coercion-conformance.mjs   (or via `pnpm check:coercion-conformance`)
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const { parse, generateCoreNode } = await import(join(REPO, 'packages/core/dist/index.js'));
const { generatePythonCoreNode } = await import(join(REPO, 'packages/python/dist/codegen-python.js'));
const tsCompiler = await import('typescript');

// Each fixture: a probe() returning the value under test. `expected` is JS/TS truth.
const FIXTURES = [
  // ── Template interpolation: scalar coercion ───────────────────────────────
  { name: 'bool in template', ret: 'string', expr: '`${true} ${false}`', expected: 'true false' },
  { name: 'null in template', ret: 'string', expr: '`${null}`', expected: 'null' },
  { name: 'undefined in template', ret: 'string', expr: '`${undefined}`', expected: 'undefined' },
  { name: 'integer-valued float in template', ret: 'string', expr: '`${1.0} ${2.5}`', expected: '1 2.5' },
  // ── Template interpolation: array / object toString ───────────────────────
  { name: 'flat array in template', ret: 'string', expr: '`${[1, 2, 3]}`', expected: '1,2,3' },
  { name: 'nested array in template (recursive)', ret: 'string', expr: '`${[1, [2, 3]]}`', expected: '1,2,3' },
  { name: 'array with nullish elements → empty', ret: 'string', expr: '`${[null, undefined, 3]}`', expected: ',,3' },
  // ── String `+` concatenation coercion ─────────────────────────────────────
  { name: 'concat string + number', ret: 'string', expr: '"n=" + 5', expected: 'n=5' },
  { name: 'concat string + bool', ret: 'string', expr: '"a" + true', expected: 'atrue' },
  // ── Mixed ─────────────────────────────────────────────────────────────────
  { name: 'mixed template (arith + bool)', ret: 'string', expr: '`count: ${1 + 2}, ok: ${true}`', expected: 'count: 3, ok: true' },
  // ── GUARD fixtures — currently GREEN, must STAY green (catch over-fixes) ───
  { name: 'GUARD numeric + stays additive', ret: 'number', expr: '2 + 3', expected: 5 },
  { name: 'GUARD nullish keeps present value', ret: 'number', expr: '5 ?? 9', expected: 5 },
  { name: 'GUARD null is nullish', ret: 'number', expr: 'null ?? 9', expected: 9 },
  { name: 'GUARD undefined stays nullish', ret: 'number', expr: 'undefined ?? 9', expected: 9 },
];

function canon(value) {
  return JSON.stringify(value);
}

const dir = mkdtempSync(join(tmpdir(), 'kern-coercion-conformance-'));
process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort tmp cleanup — never fail the run on it
  }
});

let pass = 0;
const failures = [];

for (let i = 0; i < FIXTURES.length; i++) {
  const fx = FIXTURES[i];
  try {
    const kern = `fn name=probe returns=${fx.ret}\n  handler\n    return value=${JSON.stringify(fx.expr)}`;
    const root = parse(kern);
    const topNodes = root.type === 'class' || root.type === 'fn' ? [root] : (root.children ?? []);

    const tsSource = `${topNodes.map((n) => generateCoreNode(n).join('\n')).join('\n\n')}\nconsole.log(JSON.stringify(probe()));`;
    const tsFile = join(dir, `mod-${i}.mjs`);
    writeFileSync(
      tsFile,
      tsCompiler.transpileModule(tsSource, {
        compilerOptions: { module: tsCompiler.ModuleKind.ESNext, target: tsCompiler.ScriptTarget.ES2022 },
      }).outputText,
    );

    const pySource = `import json\n${topNodes.map((n) => generatePythonCoreNode(n).join('\n')).join('\n\n')}\nprint(json.dumps(probe()))`;
    const pyFile = join(dir, `mod-${i}.py`);
    writeFileSync(pyFile, pySource);

    const opts = { encoding: 'utf8', timeout: 10_000 };
    const tsOut = JSON.parse(execFileSync('node', [tsFile], opts).trim());
    const pyOut = JSON.parse(execFileSync('python3', [pyFile], opts).trim());

    if (canon(tsOut) === canon(fx.expected) && canon(pyOut) === canon(fx.expected)) {
      pass++;
    } else {
      failures.push({ name: fx.name, expected: fx.expected, ts: tsOut, py: pyOut });
    }
  } catch (err) {
    failures.push({ name: fx.name, error: err?.stderr?.toString?.() || err?.message || String(err) });
  }
}

console.log(`Coercion conformance: ${pass}/${FIXTURES.length} fixtures passed (ts == python == expected)`);
for (const f of failures) {
  if (f.error) console.error(`  FAIL ${f.name}: ${f.error}`);
  else console.error(`  FAIL ${f.name}: expected ${canon(f.expected)} | ts ${canon(f.ts)} | py ${canon(f.py)}`);
}
if (failures.length > 0) process.exit(1);
console.log('All passed.');
