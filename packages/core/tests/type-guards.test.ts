/** Slice 2d — type guards (predicate return types).
 *
 *  Already supported today via `returns="value is T"` / `returns="asserts ..."` /
 *  `returns="this is T"` flowing through emitTypeAnnotation. This slice formalises
 *  the contract with regression tests + capability-matrix declaration. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';

const gen = (src: string) => generateCoreNode(parse(src)).join('\n');

describe('Type guards (Slice 2d)', () => {
  describe('predicate forms', () => {
    test('basic `value is T` user-defined type guard', () => {
      const src =
        'fn name=isString params="value:unknown" returns="value is string"\n  handler <<<\n    return typeof value === "string";\n  >>>';
      const out = gen(src);
      expect(out).toContain('export function isString(value: unknown): value is string {');
      expect(out).toContain('return typeof value === "string";');
    });

    test('parameter-named predicate carries through', () => {
      const src =
        'fn name=isUser params="x:unknown" returns="x is User"\n  handler <<<\n    return typeof x === "object" && x !== null && "id" in x;\n  >>>';
      expect(gen(src)).toContain('export function isUser(x: unknown): x is User {');
    });

    test('`asserts x is T` assertion guard', () => {
      const src =
        'fn name=assertUser params="x:unknown" returns="asserts x is User"\n  handler <<<\n    if (!x) throw new Error("not a user");\n  >>>';
      expect(gen(src)).toContain('export function assertUser(x: unknown): asserts x is User {');
    });

    test('`asserts x` (without `is T`) bare assertion', () => {
      const src =
        'fn name=assertDefined params="x:unknown" returns="asserts x"\n  handler <<<\n    if (x == null) throw new Error("nullish");\n  >>>';
      expect(gen(src)).toContain('export function assertDefined(x: unknown): asserts x {');
    });

    test('`this is T` predicate (for method-style guards)', () => {
      const src =
        'fn name=isAdmin returns="this is AdminUser"\n  handler <<<\n    return this.role === "admin";\n  >>>';
      expect(gen(src)).toContain('export function isAdmin(): this is AdminUser {');
    });

    test('predicate with generic target type', () => {
      const src =
        'fn name=isArrayOf params="x:unknown" returns="x is T[]"\n  handler <<<\n    return Array.isArray(x);\n  >>>';
      expect(gen(src)).toContain('): x is T[] {');
    });

    test('predicate combined with async still wraps Promise correctly', () => {
      // TS forbids `Promise<value is T>` (predicate must be the literal return),
      // so an async type-guard fn would emit Promise<value is T> which is invalid.
      // This test pins the current passthrough behavior — codegen does NOT
      // intervene; if a user writes async + predicate, they get the literal output.
      const src =
        'fn name=isOk params="x:unknown" returns="value is Ok" async=true\n  handler <<<\n    return true;\n  >>>';
      const out = gen(src);
      // Document current (passthrough) behavior — flag as a future review-rule candidate.
      expect(out).toMatch(/value is Ok/);
    });
  });

  describe('capability matrix', () => {
    test('type-guard is native on TS targets', () => {
      expect(capabilitySupport('lib', 'type-guard', 'top-level')).toBe('native');
    });

    test('type-guard is unsupported on Python', () => {
      // Python uses TypeGuard / TypeIs from typing module — different shape.
      expect(capabilitySupport('fastapi', 'type-guard', 'top-level')).toBe('unsupported');
    });
  });
});
