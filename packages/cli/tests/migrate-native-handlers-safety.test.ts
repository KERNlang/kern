/** Safety + skip-reason coverage for `kern migrate native-handlers`.
 *
 *  Complements migrate-native-handlers.test.ts (which validates supported
 *  shapes) by exercising the cases the rewriter must REFUSE — declaration-
 *  only output, unsupported TS shapes, and the source line range +
 *  skip-reason wiring used by `--check-equivalent`.
 */

import { rewriteNativeHandlers } from '../src/commands/migrate-native-handlers.js';

describe('rewriteNativeHandlers — declaration-only refusal', () => {
  test('refuses a handler that emits only `let` (no action-bearing statement)', () => {
    // Pure declaration body: `const x = …;` and nothing else. The rewriter
    // could technically emit `handler lang="kern" / let name=x value="..."`
    // and pass parser strict, but the original handler likely existed for a
    // reason we missed — leave it raw so the author audits it.
    const source = ['fn name=stub returns=void', '  handler <<<', '    const unused = compute();', '  >>>'].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.output).toBe(source);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/declaration-only output/);
    // Source line range covers the whole `handler <<< … >>>` block.
    expect(result.skipped[0].headerLine).toBe(2);
    expect(result.skipped[0].endLine).toBe(4);
  });

  test('a handler with let + return is still accepted (return is action-bearing)', () => {
    const source = [
      'fn name=greet returns=string',
      '  handler <<<',
      '    const msg = who;',
      '    return msg;',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
  });
});

describe('rewriteNativeHandlers — skip reasons', () => {
  test('reports a specific reason for ++/-- mutation', () => {
    const source = ['fn name=tick returns=void', '  handler <<<', '    counter++;', '  >>>'].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    // ++/-- bails out of native eligibility before we ever invoke the
    // statement-mapper, so the reason comes from classifyHandlerBody.
    // Either path is acceptable as long as the skip is recorded with a
    // mutation-related reason.
    expect(result.skipped[0].reason).toMatch(/not eligible|\+\+|--|mutation/);
  });

  test('reports a specific reason for an unsupported switch statement', () => {
    const source = [
      'fn name=route returns=void',
      '  handler <<<',
      '    switch (x) {',
      '      case 1: return;',
      '    }',
      '  >>>',
    ].join('\n');
    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    // switch isn't on the migratable allowlist; classifyHandlerBody rejects
    // the body and we surface its reason. The exact wording belongs to the
    // classifier — just assert a non-empty reason is reported.
    expect(result.skipped[0].reason.length).toBeGreaterThan(0);
    expect(result.skipped[0].headerLine).toBe(2);
    expect(result.skipped[0].endLine).toBe(6);
  });

  test('source line ranges on hits identify the full original block', () => {
    const source = [
      'fn name=loadAuthStore returns=any',
      '  handler <<<',
      '    const authFile = getAuthFile();',
      '    if (!existsSync(authFile)) {',
      '      return { entries: {} };',
      '    }',
      '    try {',
      '      const data = JSON.parse(readFileSync(authFile, "utf-8"));',
      '      return { entries: data };',
      '    } catch (_e) {',
      '      return { entries: {} };',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].headerLine).toBe(2);
    expect(result.hits[0].endLine).toBe(13);
    expect(result.skipped).toHaveLength(0);
  });
});

describe('rewriteNativeHandlers — nested let in try/catch/while', () => {
  // Mirror the Agon-AI sample: `let` nested inside `try` under
  // `handler lang="kern"` must round-trip without bogus diagnostics.
  test('migrates a try/catch with nested let bindings', () => {
    const source = [
      'fn name=loadAuthStore returns=any',
      '  handler <<<',
      '    const authFile = getAuthFile();',
      '    if (!existsSync(authFile)) {',
      '      return { entries: {} };',
      '    }',
      '    try {',
      '      const data = JSON.parse(readFileSync(authFile, "utf-8"));',
      '      return { entries: data };',
      '    } catch (_e) {',
      '      return { entries: {} };',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('handler lang="kern"');
    expect(result.output).toContain('try');
    expect(result.output).toContain('let name=data');
    expect(result.output).toContain('catch name=_e');
  });

  test('migrates a while loop with nested let + break', () => {
    const source = [
      'fn name=drain returns=void',
      '  handler <<<',
      '    while (queue.length > 0) {',
      '      const item = queue.shift();',
      '      if (item === null) {',
      '        break;',
      '      }',
      '      process(item);',
      '    }',
      '  >>>',
    ].join('\n');

    const result = rewriteNativeHandlers(source);
    expect(result.hits).toHaveLength(1);
    expect(result.output).toContain('while cond="queue.length > 0"');
    expect(result.output).toContain('let name=item');
    expect(result.output).toContain('break');
  });
});
