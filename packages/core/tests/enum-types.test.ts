/** Slice 2b — `enum` node tests.
 *
 *  Numeric enum: `enum name=X values="A|B|C"` → `export enum X { A, B, C }`.
 *  String enum: `enum name=X` + `member name=A value="..."` children.
 *  Const enum: `enum name=X const=true ...` prepends `const`. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode, isCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';
import { validateSemantics } from '../src/semantic-validator.js';
import { isKnownNodeType, RESERVED_FUTURE_NAMES } from '../src/spec.js';

const gen = (src: string) => generateCoreNode(parse(src)).join('\n');
const rulesFor = (src: string): string[] => validateSemantics(parse(src)).map((v) => v.rule);

describe('Enum node (Slice 2b)', () => {
  describe('spec changes', () => {
    test("'enum' is no longer a reserved future name", () => {
      expect(RESERVED_FUTURE_NAMES.includes('enum')).toBe(false);
    });

    test("'enum' is a known core node type", () => {
      expect(isKnownNodeType('enum')).toBe(true);
      expect(isCoreNode('enum')).toBe(true);
    });

    test("'member' is a known core node type", () => {
      expect(isKnownNodeType('member')).toBe(true);
      expect(isCoreNode('member')).toBe(true);
    });
  });

  describe('numeric enum (values=)', () => {
    test('basic three-member enum', () => {
      expect(gen('enum name=Status values="Pending|Active|Done"')).toBe('export enum Status { Pending, Active, Done }');
    });

    test('single-member enum', () => {
      expect(gen('enum name=One values="Only"')).toBe('export enum One { Only }');
    });

    test('export=false drops export prefix', () => {
      expect(gen('enum name=Hidden values="A|B" export=false')).toBe('enum Hidden { A, B }');
    });

    test('const enum', () => {
      expect(gen('enum name=Flag values="On|Off" const=true')).toBe('export const enum Flag { On, Off }');
    });

    test('empty enum (no values, no members)', () => {
      expect(gen('enum name=Empty')).toBe('export enum Empty {}');
    });
  });

  describe('string enum (member children)', () => {
    test('two string members', () => {
      const src = 'enum name=Direction\n  member name=Up value="UP"\n  member name=Down value="DOWN"';
      const out = gen(src);
      expect(out).toContain('export enum Direction {');
      expect(out).toContain('Up = "UP",');
      expect(out).toContain('Down = "DOWN",');
      expect(out).toContain('}');
    });

    test('member with bare numeric value', () => {
      const src = 'enum name=HttpCode\n  member name=Ok value=200\n  member name=NotFound value=404';
      const out = gen(src);
      expect(out).toContain('Ok = 200,');
      expect(out).toContain('NotFound = 404,');
    });

    test('member with expression-block value', () => {
      const src = 'enum name=Mask\n  member name=A value={{ 1 << 0 }}\n  member name=B value={{ 1 << 1 }}';
      const out = gen(src);
      expect(out).toContain('A = 1 << 0,');
      expect(out).toContain('B = 1 << 1,');
    });

    test('member without value emits bare name (default numeric)', () => {
      const src = 'enum name=Color\n  member name=Red\n  member name=Green';
      const out = gen(src);
      expect(out).toContain('Red,');
      expect(out).toContain('Green,');
    });

    test('member children take precedence over values=', () => {
      // If both are provided, members win and values is silently ignored.
      const src = 'enum name=X values="A|B"\n  member name=Custom value="custom"';
      const out = gen(src);
      expect(out).toContain('Custom = "custom",');
      expect(out).not.toContain('A,');
      expect(out).not.toContain('B,');
    });
  });

  describe('capability matrix', () => {
    test('enum-type is native on TS targets', () => {
      expect(capabilitySupport('lib', 'enum-type', 'top-level')).toBe('native');
      expect(capabilitySupport('nextjs', 'enum-type', 'top-level')).toBe('native');
    });

    test('enum-type lowers on Python targets (namespace class)', () => {
      expect(capabilitySupport('fastapi', 'enum-type', 'top-level')).toBe('lowered');
      expect(capabilitySupport('python', 'enum-type', 'top-level')).toBe('lowered');
    });
  });

  // The symmetric reverse-index / iteration gate lives in `validateSemantics`
  // (target-agnostic core), so a rejected enum operation is rejected for BOTH
  // the TS and Python targets — neither can silently diverge on a construct the
  // other can't represent. KERN enums lower to bare int/str on both sides:
  // a TS `enum` has a reverse map only on NON-const enums; a Python namespace
  // class has none, and neither iterates identically. v1 rejects both.
  describe('symmetric enum access gate (reverse-index + iteration)', () => {
    const withProbe = (body: string): string =>
      `enum name=Status values="Pending|Active|Done"\nfn name=probe\n  handler\n    ${body}`;

    test('rejects reverse-index access Status[0]', () => {
      expect(rulesFor(withProbe('return value="Status[0]"'))).toContain('enum-reverse-index');
    });

    test('rejects reverse-index with a non-literal index too', () => {
      expect(rulesFor(withProbe('return value="Status[someVar]"'))).toContain('enum-reverse-index');
    });

    test('rejects Object.keys(Status)', () => {
      expect(rulesFor(withProbe('return value="Object.keys(Status)"'))).toContain('enum-iteration');
    });

    test('rejects Object.values(Status)', () => {
      expect(rulesFor(withProbe('return value="Object.values(Status)"'))).toContain('enum-iteration');
    });

    test('rejects Object.entries(Status)', () => {
      expect(rulesFor(withProbe('return value="Object.entries(Status)"'))).toContain('enum-iteration');
    });

    test('allows static member access Status.Pending', () => {
      const rules = rulesFor(withProbe('return value="Status.Pending"'));
      expect(rules).not.toContain('enum-reverse-index');
      expect(rules).not.toContain('enum-iteration');
    });

    test('does not reject index access on a NON-enum identifier', () => {
      const src = `enum name=Status values="Pending|Active|Done"\nfn name=probe\n  handler\n    let name=arr value="[1,2,3]"\n    return value="arr[0]"`;
      expect(rulesFor(src)).not.toContain('enum-reverse-index');
    });

    test('does not reject Object.keys on a NON-enum identifier', () => {
      const src = `enum name=Status values="Pending|Active|Done"\nfn name=probe\n  handler\n    let name=obj value="{a:1}"\n    return value="Object.keys(obj)"`;
      expect(rulesFor(src)).not.toContain('enum-iteration');
    });

    test('rejects a reverse-index nested inside a larger expression', () => {
      expect(rulesFor(withProbe('return value="Status[0] + 1"'))).toContain('enum-reverse-index');
    });

    // ZERO-FP regressions from the kern-codex cross-review (probe-verified).

    test('a quoted string member VALUE is an initializer, not a body expression', () => {
      // `value="Object.keys(E)"` is the literal string "Object.keys(E)" — the
      // pre-fix gate scanned member props and false-flagged enum-iteration.
      const src = 'enum name=E\n  member name=X value="Object.keys(E)"';
      expect(rulesFor(src)).not.toContain('enum-iteration');
    });

    test('a let binding shadowing the enum name suppresses the gate (conservative)', () => {
      const src = [
        'enum name=Status values="A|B"',
        'fn name=f',
        '  handler lang=kern',
        '    let name=Status value="[10,20]"',
        '    return value="Status[0]"',
      ].join('\n');
      expect(rulesFor(src)).not.toContain('enum-reverse-index');
    });

    test('a param shadowing the enum name suppresses the gate (conservative)', () => {
      const src = [
        'enum name=Status values="A|B"',
        'fn name=f',
        '  param name=Status type=any',
        '  handler lang=kern',
        '    return value="Status[0]"',
      ].join('\n');
      expect(rulesFor(src)).not.toContain('enum-reverse-index');
    });
  });
});
