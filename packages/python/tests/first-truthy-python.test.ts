import type { IRNode } from '@kernlang/core';
import { generateCoalesce, generateFirstDefined, generateFirstTruthy } from '../src/codegen-python.js';
import { KERN_JS_HELPER_PY } from '../src/core/expr/helpers.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

// Slice S4 — ground `firstTruthy` selects the first KERN-truthy candidate via a
// `_kern_truthy`-gated, single-evaluation, lazy walrus chain (so `[]`/`{}` win and
// NaN is skipped), not bare Python `a or b`. The helper is surfaced through the
// ground prelude (module-level helper block), so a `.join('\n')` output of a
// standalone `firstTruthy` is the helper block followed by the assignment.
const GROUND_JS_PRELUDE = `${KERN_JS_HELPER_PY}\n`;

describe('Python Ground Layer: firstTruthy', () => {
  it('emits a KERN-truthiness-gated ordered fallback chain', () => {
    const node = mk('firstTruthy', { name: 'label', values: "preferred, nickname, 'Anonymous'" });
    expect(generateFirstTruthy(node).join('\n')).toBe(
      `${GROUND_JS_PRELUDE}label = (__k_ft_label_0 if _kern_truthy(__k_ft_label_0 := preferred) else (__k_ft_label_1 if _kern_truthy(__k_ft_label_1 := nickname) else "Anonymous"))`,
    );
  });

  it('parenthesizes conditional operands before gating fallbacks', () => {
    const node = mk('firstTruthy', { name: 'label', values: "ready ? preferred : nickname, 'Anonymous'" });
    expect(generateFirstTruthy(node).join('\n')).toBe(
      `${GROUND_JS_PRELUDE}label = (__k_ft_label_0 if _kern_truthy(__k_ft_label_0 := (preferred if _kern_truthy(ready) else nickname)) else "Anonymous")`,
    );
  });

  it('prepends helpers required by Array.fill operands', () => {
    const node = mk('firstTruthy', { name: 'label', values: "arr.fill(v), 'fallback'" });
    const code = generateFirstTruthy(node).join('\n');
    expect(code).toContain('def _kern_js_fill');
    expect(code).toContain(
      'label = (__k_ft_label_0 if _kern_truthy(__k_ft_label_0 := _kern_js_fill(arr, v, 0, _KERN_JS_FILL_ABSENT)) else "fallback")',
    );
    expect(code.indexOf('def _kern_js_fill')).toBeLessThan(code.indexOf('label ='));
  });

  it('keeps explicit undefined Array.fill bounds as the helper sentinel', () => {
    const node = mk('firstTruthy', { name: 'label', values: "arr.fill(v, 1, undefined), 'fallback'" });
    const code = generateFirstTruthy(node).join('\n');
    expect(code).toContain(
      'label = (__k_ft_label_0 if _kern_truthy(__k_ft_label_0 := _kern_js_fill(arr, v, 1, _KERN_UNDEFINED)) else "fallback")',
    );
  });

  it('rejects missing, unary, and propagated values', () => {
    expect(() => generateFirstTruthy(mk('firstTruthy', { name: 'x' }))).toThrow(/values/);
    expect(() => generateFirstTruthy(mk('firstTruthy', { name: 'x', values: 'preferred' }))).toThrow(/at least two/);
    expect(() => generateFirstTruthy(mk('firstTruthy', { name: 'x', values: 'load()?, fallback' }))).toThrow(
      /Propagation/,
    );
  });
});

describe('Python Ground Layer: coalesce / firstDefined', () => {
  it('emits None-only fallback logic that preserves falsy values', () => {
    const node = mk('coalesce', { name: 'winner', values: "count, flag, label, 'fallback'" });
    expect(generateCoalesce(node).join('\n')).toBe(
      'winner = (count if count is not None else (flag if flag is not None else (label if label is not None else "fallback")))',
    );
  });

  it('supports firstDefined as an alias-shaped node', () => {
    const node = mk('firstDefined', { name: 'winner', values: 'primary, secondary' });
    expect(generateFirstDefined(node).join('\n')).toBe('winner = (primary if primary is not None else secondary)');
  });

  it('parenthesizes conditional operands before joining fallbacks', () => {
    const node = mk('coalesce', { name: 'label', values: "ready ? preferred : nickname, 'Anonymous'" });
    // Slice S4 — `coalesce` SELECTION stays NULLISH (`is not None`), but the nested
    // ternary OPERAND's condition consumes ToBoolean (`_kern_truthy(ready)`), which
    // also surfaces the truthiness helper through the ground prelude.
    expect(generateCoalesce(node).join('\n')).toBe(
      `${GROUND_JS_PRELUDE}label = (__k_nc1 if (__k_nc1 := preferred if _kern_truthy(ready) else nickname) is not None else "Anonymous")`,
    );
  });

  it('uses a walrus temp so side-effecting operands are evaluated once', () => {
    const node = mk('coalesce', { name: 'winner', values: "load(), 'fallback'" });
    expect(generateCoalesce(node).join('\n')).toBe(
      'winner = (__k_nc1 if (__k_nc1 := load()) is not None else "fallback")',
    );
  });
});
