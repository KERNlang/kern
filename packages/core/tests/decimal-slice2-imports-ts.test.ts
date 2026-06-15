/** DECIMAL Slice 2 — Finding A: the TS native-handler body emitter must surface
 *  the `decimal.js` import requirement out of `emitNativeKernBodyTSWithImports`.
 *
 *  Before Slice 2 the body emitter hardcoded `imports: new Set<string>()`, so a
 *  `lang="kern"` HANDLER BODY using `Decimal.of` emitted `new Decimal(...)` but
 *  never surfaced the `decimal.js` import → a ReferenceError at runtime. Slice 2
 *  threads a PER-EMISSION import sink (`BodyEmitContext.imports`) through
 *  `exprCtxFor` into the expression emitter and returns the populated set.
 *
 *  SOUNDNESS (per-emission, not module-global): a Decimal-free body must keep an
 *  EMPTY import set — the sink is constructed fresh per `emitNativeKernBodyTSWithImports`
 *  call, so `decimal.js` never leaks into a generated file that doesn't use Decimal. */

import { emitNativeKernBodyTSWithImports } from '../src/codegen/body-ts.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('Decimal Slice 2 — TS body emitter imports threading (Finding A)', () => {
  test('a Decimal.of body surfaces the decimal.js import requirement', () => {
    const handler = makeHandler([{ type: 'let', props: { name: 'x', value: 'Decimal.of("1.5")' } }]);
    const r = emitNativeKernBodyTSWithImports(handler);
    expect(r.code).toContain('const x = new Decimal("1.5");');
    expect([...r.imports]).toEqual(['decimal.js']);
  });

  test('a Decimal.add body surfaces the import ONCE despite two constructions', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'y', value: 'Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))' } },
    ]);
    const r = emitNativeKernBodyTSWithImports(handler);
    expect(r.code).toContain('const y = new Decimal("0.1").plus(new Decimal("0.2"));');
    expect([...r.imports]).toEqual(['decimal.js']);
  });

  test('a Decimal-FREE body returns an EMPTY import set (no leak)', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'a', value: '1 + 2' } },
      { type: 'let', props: { name: 'b', value: 'Math.max(a, 3)' } },
      { type: 'return', props: { value: 'b' } },
    ]);
    const r = emitNativeKernBodyTSWithImports(handler);
    expect(r.code).toContain('const a = 1 + 2;');
    expect([...r.imports]).toEqual([]);
  });

  test('the import sink is PER-EMISSION: a Decimal emit does not pollute a later Decimal-free emit', () => {
    const decimalHandler = makeHandler([{ type: 'let', props: { name: 'x', value: 'Decimal.of("1.5")' } }]);
    const plainHandler = makeHandler([{ type: 'let', props: { name: 'a', value: '1 + 2' } }]);
    const first = emitNativeKernBodyTSWithImports(decimalHandler);
    const second = emitNativeKernBodyTSWithImports(plainHandler);
    expect([...first.imports]).toEqual(['decimal.js']);
    // The second emit got its OWN fresh sink — no carry-over from the first.
    expect([...second.imports]).toEqual([]);
  });
});
