/** Enum (namespace-class) lowering — Python target.
 *
 *  KERN `enum` nodes lower to a PLAIN Python namespace class (NOT enum.Enum /
 *  IntEnum / StrEnum / a metaclass, and with NO runtime library import). This
 *  was the tribunal-decided representation (run tribunal-1781176354539): bare
 *  int/str members give equality, arithmetic, JSON serialization and fmt
 *  interpolation parity with the TS `enum` BY CONSTRUCTION, without any runtime
 *  support. See `generatePythonEnum` in src/generators/data.ts.
 *
 *  Differential behavior (probe returns identical across TS + Python) is proven
 *  in scripts/class-conformance.mjs (ENUM1..ENUM8). The tests here pin two
 *  things the conformance harness cannot:
 *    1. EMITTED-SOURCE SHAPE — version-independent kill switch for IntEnum.
 *       `json.dumps(IntEnum.member)` serializes to the number and IntEnum
 *       supports `+`, so the arithmetic/JSON conformance probes do NOT kill an
 *       IntEnum impl; and f-string output is Python-version-dependent (excluded
 *       as a weak oracle). Asserting the emitted Python is `class Status:` with
 *       `Pending = 0` and NO `import enum` kills every alternative
 *       representation cheaply and deterministically.
 *    2. EXHAUSTIVENESS DRIFT-GATE — the silent `default: return []` in
 *       generatePythonCoreNode dropped enum before this slice. The gate below
 *       fails if a core-language top-level declaration kind is neither routed
 *       through the dispatcher nor in an explicit no-emit allowlist.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IRNode } from '@kernlang/core';
import { parse } from '@kernlang/core';
import { generatePythonCoreNode } from '../src/codegen-python.js';
import { generatePythonEnum } from '../src/generators/data.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function emit(kern: string): string {
  return generatePythonEnum(parse(kern)).join('\n');
}

describe('Python enum codegen — namespace-class lowering', () => {
  // ── (1) Emitted-source shape pinning (version-independent IntEnum killer) ──

  test('implicit numeric (values=) emits a plain namespace class — no import enum', () => {
    const code = emit('enum name=Status values="Pending|Active|Done"');
    expect(code).toContain('class Status:');
    expect(code).toContain('Pending = 0');
    expect(code).toContain('Active = 1');
    expect(code).toContain('Done = 2');
    // The crux: every alternative representation needs `enum` (or a metaclass).
    expect(code).not.toContain('import enum');
    expect(code).not.toContain('Enum');
    expect(code).not.toContain('metaclass');
  });

  test('explicit string members emit Python string literals — no import enum', () => {
    const code = emit(`enum name=Direction
  member name=Up value="UP"
  member name=Down value="DOWN"`);
    expect(code).toContain('class Direction:');
    expect(code).toContain('Up = "UP"');
    expect(code).toContain('Down = "DOWN"');
    expect(code).not.toContain('import enum');
  });

  test('explicit + implicit-after-explicit numeric mirrors TS auto-increment', () => {
    const code = emit(`enum name=Mixed
  member name=A value=10
  member name=B
  member name=C value=30
  member name=D`);
    expect(code).toContain('class Mixed:');
    // Verified against tsc runtime: A=10, B=11 (10+1), C=30, D=31 (30+1).
    expect(code).toContain('A = 10');
    expect(code).toContain('B = 11');
    expect(code).toContain('C = 30');
    expect(code).toContain('D = 31');
    expect(code).not.toContain('import enum');
  });

  test('const=true emits the SAME plain class (no inlining, no import enum)', () => {
    const code = emit('enum name=Flag const=true values="On|Off"');
    expect(code).toContain('class Flag:');
    expect(code).toContain('On = 0');
    expect(code).toContain('Off = 1');
    expect(code).not.toContain('import enum');
  });

  test('export=true is erased (Python module names are importable by default)', () => {
    const code = emit('enum name=Status export=true values="A|B"');
    // No `export` keyword in Python — mirrors generatePythonClass / generatePythonUnion.
    expect(code).toContain('class Status:');
    expect(code).not.toContain('export');
  });

  test('dispatches enum through generatePythonCoreNode (default no longer drops it)', () => {
    const code = generatePythonCoreNode(parse('enum name=Status values="Pending|Active|Done"')).join('\n');
    expect(code).toContain('class Status:');
    expect(code).toContain('Pending = 0');
  });

  // ── (2) Exhaustiveness drift-gate (kills the silent `default: return []`) ──
  //
  // A NEW top-level core-language declaration kind that is added to the parser
  // but NOT routed through generatePythonCoreNode falls through to
  // `default: return []` and is SILENTLY DROPPED (the exact bug that hid enum).
  // This gate pins the set of top-level declaration kinds the Python dispatcher
  // owns and asserts each is either (a) routed to a generator OR (b) in the
  // explicit PYTHON_NO_EMIT allowlist with a one-line rationale.
  //
  // The handled set is read from the dispatcher SOURCE (the `case '<kind>':`
  // labels) so the gate tracks the real switch, not a hand-copied mirror.

  // Top-level core-language declaration kinds the Python pipeline is responsible
  // for. (UI / CLI / route-child / body-statement / expression kinds are NOT in
  // generatePythonCoreNode's domain — they're handled by route/handler emitters
  // — so they are intentionally out of scope for THIS dispatcher's drift-gate.)
  const TOP_LEVEL_DECL_KINDS: readonly string[] = [
    'type',
    'interface',
    'fn',
    'machine',
    'module',
    'error',
    'config',
    'store',
    'test',
    'event',
    'import',
    'extern',
    'use',
    'from',
    'const',
    'model',
    'repository',
    'cache',
    'dependency',
    'service',
    'class',
    'enum',
    'union',
    'job',
    'storage',
    'email',
  ];

  // Kinds the dispatcher deliberately emits NOTHING for (returns []), each with
  // a one-line rationale. A handled kind that drops to `default` is NOT allowed
  // to hide here — it must be added consciously.
  const PYTHON_NO_EMIT: Record<string, string> = {
    from: 're-export alias resolved at module level; emits no standalone Python (the symbol is exported by its original declaration).',
  };

  function dispatcherHandledKinds(): Set<string> {
    const src = readFileSync(join(HERE, '../src/codegen-python.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function generatePythonCoreNode'));
    const handled = new Set<string>();
    for (const m of body.matchAll(/case\s+'([^']+)'\s*:/g)) handled.add(m[1]);
    return handled;
  }

  test('every top-level declaration kind is routed or explicitly no-emit', () => {
    const handled = dispatcherHandledKinds();
    const drift: string[] = [];
    for (const kind of TOP_LEVEL_DECL_KINDS) {
      const isRouted = handled.has(kind);
      const isNoEmit = Object.hasOwn(PYTHON_NO_EMIT, kind);
      if (!isRouted && !isNoEmit) {
        drift.push(kind);
      }
    }
    // A non-empty list means a top-level kind would silently `return []`.
    expect(drift).toEqual([]);
  });

  test('routed top-level kinds (minus no-emit) emit non-empty Python', () => {
    // Minimal valid fixtures for the type-system declaration kinds enum sits
    // among. Proves the route actually produces code (not an empty array that
    // masquerades as "handled"). `from` is the sole no-emit kind and is excluded.
    const minimal: Record<string, IRNode> = {
      type: parse('type name=Id alias=string'),
      interface: parse('interface name=Shape\n  field name=x type=number'),
      enum: parse('enum name=Status values="Pending|Active|Done"'),
      union: parse('union name=U discriminant=type\n  variant name=a\n    field name=x type=number'),
      class: parse('class name=Box\n  field name=x type=number'),
      const: parse('const name=PI value=3'),
    };
    for (const [kind, node] of Object.entries(minimal)) {
      const out = generatePythonCoreNode(node);
      expect(out.length > 0).toBe(true);
      // Sanity: a no-emit kind must not be in this positive set.
      expect(Object.hasOwn(PYTHON_NO_EMIT, kind)).toBe(false);
    }
  });

  test('PYTHON_NO_EMIT kinds actually emit nothing through the dispatcher', () => {
    // `from` is a re-export alias — generatePythonCoreNode returns [] for it.
    const out = generatePythonCoreNode({ type: 'from', props: { path: './x', as: 'y' }, children: [] });
    expect(out).toEqual([]);
  });
});
