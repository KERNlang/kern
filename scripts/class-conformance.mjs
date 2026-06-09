/**
 * Class differential conformance — KERN single-source class parity.
 *
 * Each fixture is a self-contained KERN module: a class (or class hierarchy)
 * plus a zero-arg `fn probe` that exercises it. The module is compiled through
 * BOTH codegen paths (core -> TypeScript, python -> pure Python), each driver
 * calls `probe()` and prints its JSON-normalized return, and we assert
 * ts == python == expected. This proves class behavior is identical across
 * targets BY CONSTRUCTION (both derive from one definition), not by hand-diffing
 * two emitters.
 *
 * Scope: portable probes only (number/string ops). List mutation needs a
 * portable list-append lowering and is exercised separately (unit tests prove
 * the instance-field-default isolation directly).
 *
 * Run:  node scripts/class-conformance.mjs   (or via `pnpm check:class-conformance`)
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

const FIXTURES = [
  {
    name: 'construction + fields + method',
    kern: `class name=Point export=true
  field name=x type=number
  field name=y type=number
  constructor
    param name=x type=number
    param name=y type=number
    handler
      assign target="this.x" value="x"
      assign target="this.y" value="y"
  method name=sum returns=number
    handler
      return value="this.x + this.y"
fn name=probe returns=number
  handler
    return value="new Point(3, 4).sum()"`,
    expected: 7,
  },
  {
    name: 'single inheritance + super constructor + super method',
    kern: `class name=Animal export=true
  field name=name type=string
  constructor
    param name=name type=string
    handler
      assign target="this.name" value="name"
  method name=describe returns=string
    handler
      return value="\`\${this.name} is an animal\`"
class name=Dog extends=Animal export=true
  constructor
    param name=name type=string
    handler
      do value="super(name)"
  method name=describe returns=string
    handler
      return value="\`\${super.describe()} (a dog)\`"
fn name=probe returns=string
  handler
    return value="new Dog(\\"Rex\\").describe()"`,
    expected: 'Rex is an animal (a dog)',
  },
  {
    name: 'instance getter',
    kern: `class name=Person export=true
  field name=first type=string
  field name=last type=string
  constructor
    param name=first type=string
    param name=last type=string
    handler
      assign target="this.first" value="first"
      assign target="this.last" value="last"
  getter name=full returns=string
    handler
      return value="\`\${this.first} \${this.last}\`"
fn name=probe returns=string
  handler
    return value="new Person(\\"Ada\\", \\"Lovelace\\").full"`,
    expected: 'Ada Lovelace',
  },
  {
    name: 'static method',
    kern: `class name=MathBox export=true
  method name=double static=true returns=number
    param name=n type=number
    handler
      return value="n * 2"
fn name=probe returns=number
  handler
    return value="MathBox.double(21)"`,
    expected: 42,
  },
  {
    name: 'instance field default (read, no constructor)',
    kern: `class name=Config export=true
  field name=mode type=string value={{ "dev" }}
fn name=probe returns=string
  handler
    return value="new Config().mode"`,
    expected: 'dev',
  },
  {
    name: 'getter + setter + field default round-trip',
    kern: `class name=Cell export=true
  field name=v type=number value={{ 0 }}
  getter name=value returns=number
    handler
      return value="this.v"
  setter name=value
    param name=next type=number
    handler
      assign target="this.v" value="next"
fn name=probe returns=number
  handler
    let name=c value="new Cell()"
    assign target="c.value" value="9"
    return value="c.value"`,
    expected: 9,
  },
];

const canon = (v) => JSON.stringify(v);

const dir = mkdtempSync(join(tmpdir(), 'kern-class-conf-'));
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
    const root = parse(fx.kern);
    // A single top-level decl parses as the node itself; multiple decls wrap in a root.
    const topNodes = root.type === 'class' || root.type === 'fn' ? [root] : (root.children ?? []);

    // TypeScript module
    const tsSource = `${topNodes.map((n) => generateCoreNode(n).join('\n')).join('\n\n')}\nconsole.log(JSON.stringify(probe()));`;
    const tsFile = join(dir, `mod-${i}.mjs`);
    writeFileSync(
      tsFile,
      tsCompiler.transpileModule(tsSource, {
        compilerOptions: { module: tsCompiler.ModuleKind.ESNext, target: tsCompiler.ScriptTarget.ES2022 },
      }).outputText,
    );

    // Python module
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

console.log(`Class conformance: ${pass}/${FIXTURES.length} fixtures passed (ts == python == expected)`);
for (const f of failures) {
  if (f.error) console.error(`  FAIL ${f.name}: ${f.error}`);
  else console.error(`  FAIL ${f.name}: expected ${canon(f.expected)} | ts ${canon(f.ts)} | py ${canon(f.py)}`);
}
if (failures.length > 0) process.exit(1);
console.log('All passed.');
