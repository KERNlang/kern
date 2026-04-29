/** Slice 6 — `effects=pure` validator tests.
 *
 *  Spec: docs/language/effects-pure-spec.md.
 *  Validator: packages/core/src/parser-validate-effects.ts. */

import { generateCoreNode } from '../src/codegen-core.js';
import { parse, parseDocumentWithDiagnostics } from '../src/parser.js';

function diagnosticsFor(src: string) {
  return parseDocumentWithDiagnostics(src).diagnostics;
}

function effectsErrors(src: string) {
  return diagnosticsFor(src).filter((d) => d.code === 'INVALID_EFFECTS');
}

function gen(src: string): string {
  return generateCoreNode(parse(src)).join('\n');
}

describe('effects=pure — slice 6 validator', () => {
  // ── Happy path: pure body passes ───────────────────────────────────

  test('pure fn with arithmetic body passes', () => {
    expect(
      effectsErrors(
        [
          'fn name=clamp params="value:number,min:number,max:number" returns=number effects=pure',
          '  handler <<<',
          '    return Math.max(min, Math.min(max, value));',
          '  >>>',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  test('pure derive with simple expression passes', () => {
    expect(effectsErrors('derive name=double expr={{ value * 2 }} effects=pure\n')).toEqual([]);
  });

  test('pure memo with filter handler passes', () => {
    expect(
      effectsErrors(
        [
          'memo name=visible deps="items,filter" effects=pure',
          '  handler <<<',
          '    return items.filter(it => it.kind === filter);',
          '  >>>',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  test('pure fn calling another pure fn passes (no cross-fn check in v1)', () => {
    expect(
      effectsErrors(
        [
          'fn name=normalize params="s:string" returns=string effects=pure',
          '  handler <<<',
          '    return s.trim().toLowerCase();',
          '  >>>',
          'fn name=greet params="s:string" returns=string effects=pure',
          '  handler <<<',
          '    return "hello " + normalize(s);',
          '  >>>',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  test('pure fn with throw is allowed', () => {
    // Errors are values; throw is not an effect that the walker rejects.
    expect(
      effectsErrors(
        [
          'fn name=parse params="s:string" returns=number effects=pure',
          '  handler <<<',
          '    if (!s) throw new Error("empty");',
          '    return parseInt(s, 10);',
          '  >>>',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  // ── Forbidden patterns — I/O ───────────────────────────────────────

  test('rejects fetch() in pure fn body', () => {
    const errs = effectsErrors(
      [
        'fn name=load returns="Promise<string>" effects=pure',
        '  handler <<<',
        '    return fetch("/api/x").then(r => r.text());',
        '  >>>',
      ].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/fetch\(/);
  });

  test('rejects console.log in pure fn body', () => {
    const errs = effectsErrors(
      [
        'fn name=tap params="value:number" returns=number effects=pure',
        '  handler <<<',
        '    console.log(value);',
        '    return value;',
        '  >>>',
      ].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/console\./);
  });

  test('rejects readFileSync in pure fn body', () => {
    const errs = effectsErrors(
      [
        'fn name=loadConfig returns=string effects=pure',
        '  handler <<<',
        '    return readFileSync("/etc/config", "utf8");',
        '  >>>',
      ].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/readFileSync/);
  });

  test('rejects localStorage access in pure fn body', () => {
    const errs = effectsErrors(
      [
        'fn name=loadToken returns=string effects=pure',
        '  handler <<<',
        '    return localStorage.getItem("token") || "";',
        '  >>>',
      ].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/localStorage/);
  });

  // ── Forbidden patterns — time / randomness ─────────────────────────

  test('rejects Math.random in pure fn body', () => {
    const errs = effectsErrors(
      ['fn name=roll returns=number effects=pure', '  handler <<<', '    return Math.random();', '  >>>'].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/Math\.random/);
  });

  test('rejects Date.now in pure derive expr', () => {
    const errs = effectsErrors('derive name=ts expr={{ Date.now() }} effects=pure\n');
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/Date\.now/);
  });

  test('rejects new Date() with no args in pure body', () => {
    const errs = effectsErrors(
      ['fn name=stamp returns=Date effects=pure', '  handler <<<', '    return new Date();', '  >>>'].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/new Date/);
  });

  test('rejects crypto.randomUUID in pure body', () => {
    const errs = effectsErrors(
      ['fn name=newId returns=string effects=pure', '  handler <<<', '    return crypto.randomUUID();', '  >>>'].join(
        '\n',
      ),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/crypto\.randomUUID/);
  });

  // ── Forbidden patterns — async / scheduling ────────────────────────

  test('rejects await keyword in pure body', () => {
    const errs = effectsErrors(
      [
        'fn name=load returns="Promise<string>" effects=pure',
        '  handler <<<',
        '    return await getText();',
        '  >>>',
      ].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/await/);
  });

  test('rejects setTimeout in pure body', () => {
    const errs = effectsErrors(
      ['fn name=schedule returns=void effects=pure', '  handler <<<', '    setTimeout(() => 1, 0);', '  >>>'].join(
        '\n',
      ),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/setTimeout/);
  });

  test('rejects .then( in pure body', () => {
    const errs = effectsErrors(
      [
        'fn name=load returns=number effects=pure',
        '  handler <<<',
        '    return getValue().then(v => v + 1);',
        '  >>>',
      ].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/\.then/);
  });

  // ── Hard rejections — incompatible prop combinations ──────────────

  test('rejects effects=pure combined with async=true', () => {
    const errs = effectsErrors(
      [
        'fn name=fetchData returns="Promise<string>" async=true effects=pure',
        '  handler <<<',
        '    return "x";',
        '  >>>',
      ].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/async=true/);
  });

  test('rejects effects=pure combined with stream=true', () => {
    const errs = effectsErrors(
      ['fn name=tick returns=number stream=true effects=pure', '  handler <<<', '    yield 1;', '  >>>'].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/stream=true/);
  });

  // ── Hard rejections — disallowed node types ───────────────────────

  test('rejects effects=pure on method node', () => {
    const errs = effectsErrors(
      [
        'class name=Calc',
        '  method name=double params="x:number" returns=number effects=pure',
        '    handler <<<',
        '      return x * 2;',
        '    >>>',
      ].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/only allowed on `fn`, `derive`, or `memo`/);
  });

  test('rejects effects=pure on handler node', () => {
    const errs = effectsErrors(
      [
        'fn name=double params="x:number" returns=number',
        '  handler effects=pure <<<',
        '    return x * 2;',
        '  >>>',
      ].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/only allowed on `fn`, `derive`, or `memo`/);
  });

  // ── Hard rejections — non-`pure` value ────────────────────────────

  test('rejects effects=throws (slice 6 only accepts `pure`)', () => {
    const errs = effectsErrors(
      [
        'fn name=parse params="s:string" returns=number effects=throws',
        '  handler <<<',
        '    return parseInt(s, 10);',
        '  >>>',
      ].join('\n'),
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toMatch(/only accepts the literal `pure`/);
  });

  // ── Codegen unaffected ────────────────────────────────────────────

  test('passing pure fn emits unchanged TypeScript (annotation is metadata only)', () => {
    const code = gen(
      [
        'fn name=clamp params="value:number,min:number,max:number" returns=number effects=pure',
        '  handler <<<',
        '    return Math.max(min, Math.min(max, value));',
        '  >>>',
      ].join('\n'),
    );
    expect(code).toContain('function clamp(value: number, min: number, max: number): number {');
    expect(code).toContain('return Math.max(min, Math.min(max, value));');
  });
});
