/** Adversarial edge cases surfaced during the slice 7 3-buddy review.
 *  Each test pins behavior that was previously broken in the IIFE
 *  lowering or in the loose recognition pass. */

import { rewritePropagationInBody } from '../src/parser-validate-propagation.js';

const ctx = {
  resultFns: new Set(['parseUser', 'getResult']),
  optionFns: new Set(['getOption']),
};

describe('Slice 7 — adversarial edge cases', () => {
  test('rejects `await call()?` with INVALID_PROPAGATION (no `await?` fusion in v1)', () => {
    let diag = '';
    const out = rewritePropagationInBody('const u = await getResult(id)?;', 'result', ctx, (code) => {
      diag = code;
    });
    expect(diag).toBe('INVALID_PROPAGATION');
    // Must not lower into anything that checks `Promise.kind`.
    expect(out.code).not.toContain("__k_t1.kind === 'err'");
  });

  test('parenthesised call `(await getResult(id))?` is preserved verbatim', () => {
    const out = rewritePropagationInBody('const u = (await getResult(id))?;', 'result', ctx, () => {});
    expect(out.code).toBe('const u = (await getResult(id))?;');
  });

  test('chained propagation `??` emits NESTED_PROPAGATION and does not rewrite', () => {
    let diag = '';
    const out = rewritePropagationInBody('const u = getResult()??;', 'result', ctx, (code) => {
      diag = code;
    });
    expect(diag).toBe('NESTED_PROPAGATION');
    expect(out.code).toBe('const u = getResult()??;');
  });

  test('rejects mixed-kind `Option callee ? in Result fn` with INVALID_PROPAGATION', () => {
    let diag = '';
    const out = rewritePropagationInBody('const v = getOption()?;', 'result', ctx, (code) => {
      diag = code;
    });
    expect(diag).toBe('INVALID_PROPAGATION');
    expect(out.code).toBe('const v = getOption()?;');
  });

  test('mid-expression `foo(x => x, getResult()?)` rejects with INVALID_PROPAGATION', () => {
    let diag = '';
    rewritePropagationInBody('foo(x => x, getResult()?);', 'result', ctx, (code) => {
      diag = code;
    });
    expect(diag).toBe('INVALID_PROPAGATION');
  });

  test('TS non-null `closeSync(this.fd!)` is preserved (not a propagation site)', () => {
    const out = rewritePropagationInBody('closeSync(this.fd!);', 'other', ctx, () => {});
    expect(out.code).toBe('closeSync(this.fd!);');
  });

  test('object-literal method shorthand body is treated as a closure (rejected)', () => {
    let diag = '';
    rewritePropagationInBody('const o = { foo() { getResult()?; } };', 'result', ctx, (code) => {
      diag = code;
    });
    expect(diag).toBe('INVALID_PROPAGATION');
  });
});
