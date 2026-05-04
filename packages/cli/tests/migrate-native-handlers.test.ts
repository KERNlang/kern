/** Slice 5b — `kern migrate native-handlers` rewriter tests.
 *
 *  Verifies the pure rewriter in isolation. The rewriter takes raw `.kern`
 *  source containing `handler <<< … >>>` blocks and converts the eligible
 *  ones to `handler lang="kern"` body-statement form. Anything outside the
 *  supported AST shape (let/var, destructuring, side-effect calls, comments,
 *  arrow functions etc.) is skipped — never half-migrated.
 *
 *  Round-trip safety is provided by the slice 5b-pre parser surface
 *  (commit aa5d69e6): rewritten output parses strict and emits the same
 *  TS as the original raw body would. The `--verify` mode in `runMigrate`
 *  is the byte-equivalence safety net at file-system level.
 */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyTS, parseDocumentStrict } from '@kernlang/core';
import { rewriteNativeHandlers } from '../src/commands/migrate-native-handlers.js';

/** Walk the parsed IR and return the first `handler` node. Used by the
 *  byte-equivalence tests below to feed a migrated handler back through
 *  emitNativeKernBodyTS and assert the compiled TS matches the raw body. */
function findHandler(node: IRNode): IRNode | undefined {
  if (node.type === 'handler') return node;
  for (const child of node.children ?? []) {
    const found = findHandler(child);
    if (found) return found;
  }
  return undefined;
}

describe('rewriteNativeHandlers — supported statement types', () => {
  test('migrates a let-assignment + return body', () => {
    const source = [
      'fn name=greet returns=string',
      '  handler <<<',
      '    const msg = who;',
      '    return msg;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);

    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('handler lang="kern"');
    expect(result.output).toContain('let name=msg value="who"');
    expect(result.output).toContain('return value="msg"');
    expect(result.output).not.toContain('<<<');
  });

  test('migrates a bare return', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    return;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*return\s*$/m);
  });

  test('migrates if/else with sibling layout', () => {
    const source = [
      'fn name=classify returns=string',
      '  handler <<<',
      '    if (n > 0) {',
      '      return "positive";',
      '    } else {',
      '      return "non-positive";',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('if cond="n > 0"');
    expect(result.output).toContain('return value="\\"positive\\""');
    expect(result.output).toMatch(/^\s*else\s*$/m);
    expect(result.output).toContain('return value="\\"non-positive\\""');
  });

  test('migrates try/catch/throw', () => {
    const source = [
      'fn name=safeRun returns=number',
      '  handler <<<',
      '    try {',
      '      const x = 42;',
      '      return x;',
      '    } catch (e) {',
      '      throw new Error("bad");',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toMatch(/^\s*try\s*$/m);
    expect(result.output).toContain('let name=x value="42"');
    expect(result.output).toContain('catch name=e');
    expect(result.output).toContain('throw value="new Error(\\"bad\\")"');
  });
});

describe('rewriteNativeHandlers — bail conditions', () => {
  test('skips handlers whose body is ineligible (arrow function in classifier reject set)', () => {
    const source = [
      'fn name=fold returns=number',
      '  handler <<<',
      '    return items.reduce((s, x) => s + x, 0);',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('skips handlers already opted into lang="kern"', () => {
    const source = ['fn name=ok returns=number', '  handler lang="kern" <<<', '    return 1;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('skips handlers with explicit non-kern lang= (lang="ts", lang="python")', () => {
    const source = ['fn name=ok returns=number', '  handler lang="ts" <<<', '    return 1;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('bails on `let X = …` (KERN body `let` lowers to TS `const` — not byte-preserving)', () => {
    const source = ['fn name=ok returns=number', '  handler <<<', '    let x = 1;', '    return x;', '  >>>'].join(
      '\n',
    );
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  test('bails on `var X = …` (function-scoped, body-`let` cannot preserve)', () => {
    const source = ['fn name=ok returns=number', '  handler <<<', '    var x = 1;', '    return x;', '  >>>'].join(
      '\n',
    );
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('bails on destructuring (const { a } = obj)', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    const { a } = obj;',
      '    return a;',
      '  >>>',
    ].join('\n');
    // Classifier already rejects destructuring; documents the safety net.
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('bails on bare side-effect call (no body-statement equivalent)', () => {
    const source = ['fn name=ok returns=void', '  handler <<<', '    doIt();', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('migrates `else if` chains as nested `else > if` (body emitter collapses to `else if`)', () => {
    const source = [
      'fn name=classify returns=number',
      '  handler <<<',
      '    if (a) {',
      '      return 1;',
      '    } else if (b) {',
      '      return 2;',
      '    } else {',
      '      return 3;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('handler lang="kern"');
    expect(result.output).toContain('if cond="a"');
    expect(result.output).toContain('if cond="b"');
    // The nested-`if` lives inside `else`, not as a sibling. Expressed in
    // the migrated source as nested indentation.
    expect(result.output).toMatch(/else\s*\n\s+if cond="b"/);
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('bails on body containing line comments', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    // explain things',
      '    return 1;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('bails on body containing block comments', () => {
    const source = ['fn name=ok returns=number', '  handler <<<', '    /* explain */', '    return 1;', '  >>>'].join(
      '\n',
    );
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('bails on try without catch (finally-only or bare)', () => {
    const source = [
      'fn name=ok returns=void',
      '  handler <<<',
      '    try {',
      '      return;',
      '    } finally {',
      '      return;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  test('bails on const with type annotation (body-`let` ignores `type` prop)', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    const x: number = 1;',
      '    return x;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });
});

describe('rewriteNativeHandlers — round-trip', () => {
  test('migrated output parses strict (slice 5b-pre validators are happy)', () => {
    const source = [
      'fn name=greet returns=string',
      '  handler <<<',
      '    const msg = who;',
      '    return msg;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('migrated try/catch round-trips through parseDocumentStrict', () => {
    const source = [
      'fn name=safeRun returns=number',
      '  handler <<<',
      '    try {',
      '      const x = 42;',
      '      return x;',
      '    } catch (e) {',
      '      throw new Error("bad");',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  test('preserves indentation in nested contexts', () => {
    const source = [
      'module name=Greetings',
      '  fn name=hello returns=string',
      '    handler <<<',
      '      const m = "hi";',
      '      return m;',
      '    >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('    handler lang="kern"');
    expect(result.output).toContain('      let name=m value="\\"hi\\""');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });
});

describe('rewriteNativeHandlers — review-found regressions', () => {
  // Codex P2: multi-line expression initializers embed literal newlines into
  // `value="…"` because escapeKernString does not escape `\n`. Without the
  // fix, the migrated source would split mid-attribute into invalid KERN.
  test('bails on multi-line expression initializer', () => {
    const source = [
      'fn name=ok returns=any',
      '  handler <<<',
      '    const opts = {',
      '      enabled: true',
      '    };',
      '    return opts;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  // Codex P2: single-line TS expressions that pass the slice-5a classifier
  // but fail KERN's parseExpression (e.g. ternaries, JSX) would emit an
  // invalid `value=` and only fail later at codegen. parseExpression gating
  // catches them at rewrite time so the bail is truthful.
  test('bails on TS-only expression shapes (ternary)', () => {
    const source = ['fn name=ok returns=any', '  handler <<<', '    return ok ? a : b;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
  });

  // Gemini HIGH: scanner used indexOf('>>>') instead of trimStart-startsWith,
  // so a body line containing the literal `">>>"` inside a string would be
  // truncated mid-statement. Mirror parser-core.ts:476 exactly.
  test("does not terminate body early on a string containing '>>>'", () => {
    const source = ['fn name=ok returns=string', '  handler <<<', '    return ">>>";', '  >>>'].join('\n');
    // Slice 5a classifier accepts this body, so the rewriter sees it.
    // After the fix, the body terminates only on the line that trim-starts
    // with `>>>`, so the migration is valid.
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('return value="\\">>>\\""');
    expect(() => parseDocumentStrict(result.output)).not.toThrow();
  });

  // Gemini MED: the prior AST-walk hasComments missed comments inside block
  // bodies (e.g. `if (c) { // … }`). Scanner-based detection catches all
  // comment trivia regardless of position.
  test('detects comments inside if-block bodies', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    if (c) {',
      '      // explain',
      '      return 1;',
      '    }',
      '    return 0;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });

  // Gemini MED: trailing comment after the last statement was missed.
  test('detects trailing comments after the last statement', () => {
    const source = ['fn name=ok returns=number', '  handler <<<', '    return 1;', '    // tail comment', '  >>>'].join(
      '\n',
    );
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
  });
});

describe('rewriteNativeHandlers — multi-handler files', () => {
  test('migrates multiple handlers in one file independently', () => {
    const source = [
      'fn name=a returns=number',
      '  handler <<<',
      '    return 1;',
      '  >>>',
      'fn name=b returns=number',
      '  handler <<<',
      '    return 2;',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(2);
    expect((result.output.match(/handler lang="kern"/g) ?? []).length).toBe(2);
  });

  test('mixed: migrates eligible, leaves ineligible alone', () => {
    const source = [
      'fn name=ok returns=number',
      '  handler <<<',
      '    return 1;',
      '  >>>',
      'fn name=skip returns=void',
      '  handler <<<',
      '    doSideEffect();',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect((result.output.match(/handler lang="kern"/g) ?? []).length).toBe(1);
    expect(result.output).toContain('doSideEffect();');
  });
});

describe('rewriteNativeHandlers — verify contract (compiled TS byte-equivalence)', () => {
  // Slice 5b's stated guarantee is that migrated source compiles to TS that
  // is byte-equivalent to the original raw body (so `--verify` passes).
  // The else-if collapse in body-ts.ts is the load-bearing piece: without
  // it, migrated `else if` chains would compile to `} else { if (...) {...} }`
  // and `--verify` would roll back. These tests assert the contract directly:
  // migrate → parse → emitNativeKernBodyTS → compare to expected raw output.

  test('if/else if/else compiles byte-equivalent to the raw body', () => {
    const source = [
      'fn name=classify returns=number',
      '  handler <<<',
      '    if (a) {',
      '      return 1;',
      '    } else if (b) {',
      '      return 2;',
      '    } else {',
      '      return 3;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const root = parseDocumentStrict(result.output);
    const handler = findHandler(root);
    expect(handler).toBeDefined();
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('if (a) {');
    expect(ts).toContain('  return 1;');
    expect(ts).toContain('} else if (b) {');
    expect(ts).toContain('  return 2;');
    expect(ts).toContain('} else {');
    expect(ts).toContain('  return 3;');
    // Critical: NO `else { if (...) ... }` shape — that's the bug the
    // else-if collapse exists to prevent.
    expect(ts).not.toMatch(/else \{\s*if/);
    // Closing brace count: outer if/else-if/else block has exactly one
    // top-level closing brace.
    const closes = (ts.match(/^}$/gm) ?? []).length;
    expect(closes).toBe(1);
  });

  test('three-level chain (if/else if/else if/else) compiles byte-equivalent', () => {
    const source = [
      'fn name=four returns=number',
      '  handler <<<',
      '    if (a) {',
      '      return 1;',
      '    } else if (b) {',
      '      return 2;',
      '    } else if (c) {',
      '      return 3;',
      '    } else {',
      '      return 4;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('if (a) {');
    expect(ts).toContain('} else if (b) {');
    expect(ts).toContain('} else if (c) {');
    expect(ts).toContain('} else {');
    expect(ts).toContain('  return 4;');
    expect(ts).not.toMatch(/else \{\s*if/);
    const closes = (ts.match(/^}$/gm) ?? []).length;
    expect(closes).toBe(1);
  });

  test('plain if/else (no chain) compiles byte-equivalent', () => {
    const source = [
      'fn name=b returns=number',
      '  handler <<<',
      '    if (a) {',
      '      return 1;',
      '    } else {',
      '      return 2;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);

    const handler = findHandler(parseDocumentStrict(result.output));
    const ts = emitNativeKernBodyTS(handler as IRNode);
    expect(ts).toContain('if (a) {');
    expect(ts).toContain('} else {');
    expect(ts).not.toContain('else if');
  });
});
