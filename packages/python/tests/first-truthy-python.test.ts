import type { IRNode } from '@kernlang/core';
import { generateCoalesce, generateFirstDefined, generateFirstTruthy } from '../src/codegen-python.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('Python Ground Layer: firstTruthy', () => {
  it('emits ordered short-circuit fallback logic', () => {
    const node = mk('firstTruthy', { name: 'label', values: "preferred, nickname, 'Anonymous'" });
    expect(generateFirstTruthy(node).join('\n')).toBe('label = preferred or nickname or "Anonymous"');
  });

  it('parenthesizes conditional operands before joining fallbacks', () => {
    const node = mk('firstTruthy', { name: 'label', values: "ready ? preferred : nickname, 'Anonymous'" });
    expect(generateFirstTruthy(node).join('\n')).toBe('label = (preferred if ready else nickname) or "Anonymous"');
  });

  it('prepends helpers required by Array.fill operands', () => {
    const node = mk('firstTruthy', { name: 'label', values: "arr.fill(v), 'fallback'" });
    const code = generateFirstTruthy(node).join('\n');
    expect(code).toContain('def _kern_js_fill');
    expect(code).toContain('label = _kern_js_fill(arr, v, 0, _KERN_JS_FILL_ABSENT) or "fallback"');
    expect(code.indexOf('def _kern_js_fill')).toBeLessThan(code.indexOf('label ='));
  });

  it('keeps explicit undefined Array.fill bounds as the helper sentinel', () => {
    const node = mk('firstTruthy', { name: 'label', values: "arr.fill(v, 1, undefined), 'fallback'" });
    const code = generateFirstTruthy(node).join('\n');
    expect(code).toContain('label = _kern_js_fill(arr, v, 1, _KERN_UNDEFINED) or "fallback"');
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
    expect(generateCoalesce(node).join('\n')).toBe(
      'label = (__k_nc1 if (__k_nc1 := preferred if ready else nickname) is not None else "Anonymous")',
    );
  });

  it('uses a walrus temp so side-effecting operands are evaluated once', () => {
    const node = mk('coalesce', { name: 'winner', values: "load(), 'fallback'" });
    expect(generateCoalesce(node).join('\n')).toBe(
      'winner = (__k_nc1 if (__k_nc1 := load()) is not None else "fallback")',
    );
  });
});
