/** parseExpression — type-assertion / type-text scanner uses correct token-end.
 *
 *  Pre-change: `consumeTypeAssertionText` (and 3 sibling scanners — return-type,
 *  lambda-param-type, call-type-args) advanced their `end` cursor with
 *  `advanced.pos + advanced.value.length`. For `str` tokens, `value` is the
 *  UNESCAPED inner content (no quotes, escapes collapsed), so `value.length`
 *  is smaller than the source span by 2 + (escape count). When a type-text
 *  ENDED on a string literal — the very common `x as 'a' | 'b' | 'c'` shape —
 *  the slice cursor landed ON the closing quote and chopped off the final
 *  `'`. Example: `'info' as 'error' | 'warning' | 'info'` emitted as
 *  `'info' as 'error' | 'warning' | 'inf` (lost `o'`). Same root-cause class
 *  affects `regex` tokens (slashes + flags) and `tmplStart` (whole template
 *  consumed but `value` is the lone backtick).
 *
 *  Fix: tokens now carry an optional `end` source offset; the 4 type-text
 *  scanners route through `tokenEnd(t)` instead of doing the brittle arithmetic.
 *  Cross-target safe — pure parser change; both TS and Python codegens see
 *  the corrected expression text.
 */

import { emitExpression } from '../src/codegen-expression.js';
import { parseExpression } from '../src/parser-expression.js';

function roundTrip(source: string): string {
  return emitExpression(parseExpression(source));
}

describe('type-assertion text — trailing-string truncation regression', () => {
  test('the exact bug from the field report round-trips losslessly', () => {
    const src = "'info' as 'error' | 'warning' | 'info'";
    expect(roundTrip(src)).toBe(src);
  });

  test('single-string assertion type round-trips', () => {
    expect(roundTrip("x as 'literal'")).toBe("x as 'literal'");
  });

  test('union of string literals round-trips', () => {
    expect(roundTrip("'a' as 'a' | 'b' | 'c'")).toBe("'a' as 'a' | 'b' | 'c'");
  });

  test('identifier-typed assertion is unaffected (regression guard)', () => {
    expect(roundTrip('x as Foo')).toBe('x as Foo');
  });

  test('escaped quotes inside the assertion type round-trip', () => {
    // The escape-aware fix matters here: source spans 8 chars for `'a\\'b'`,
    // but value.length is 3 (`a'b`). The `end` field carries the true span.
    expect(roundTrip("x as 'a\\'b' | 'c'")).toBe("x as 'a\\'b' | 'c'");
  });

  test('double-quote-flavoured trailing literal round-trips', () => {
    expect(roundTrip('x as "a" | "b"')).toBe('x as "a" | "b"');
  });
});

describe('type-text scanners — same fix applies to return-type / lambda-param-type / call-type-args', () => {
  // These call other consumers (consumeReturnTypeText etc.) which share the
  // same `end = advanced.pos + advanced.value.length` pattern, so the fix
  // must apply consistently. Round-trip is the quickest way to confirm.
  test('arrow with parameter-type-text ending on a string literal', () => {
    const src = "(x: 'a' | 'b') => x";
    expect(roundTrip(src)).toBe(src);
  });
});
