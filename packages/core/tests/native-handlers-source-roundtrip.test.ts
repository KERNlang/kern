/** Native KERN handler bodies — slice 5b-pre source-roundtrip.
 *
 *  Verifies that `.kern` source containing `handler lang="kern"` with body-
 *  statement children parses to the same IR shape that the body emitters
 *  consume, and that the emitted TS output matches.
 *
 *  Slices 4a-4d shipped the body emitters but every test constructed IR
 *  directly. Slice 5b's source rewriter (the `kern migrate native-handlers`
 *  CLI) needs the parser-side surface to round-trip — these tests guarantee
 *  it does, and that the body-statement context validator rejects orphan
 *  `return`/`throw` outside `lang="kern"` scope.
 */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { decompile } from '../src/decompiler.js';
import { parseDocumentStrict, parseDocumentWithDiagnostics } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function findFirstHandler(root: IRNode): IRNode {
  if (root.type === 'handler') return root;
  for (const child of root.children ?? []) {
    const found = findFirstHandlerOrUndefined(child);
    if (found) return found;
  }
  throw new Error('no handler in tree');
}

function findFirstHandlerOrUndefined(node: IRNode): IRNode | undefined {
  if (node.type === 'handler') return node;
  for (const child of node.children ?? []) {
    const found = findFirstHandlerOrUndefined(child);
    if (found) return found;
  }
  return undefined;
}

describe('slice 5b-pre — body-statement source round-trip (positive)', () => {
  test('let + return parse and emit through the body emitter', () => {
    const src = [
      'fn name=greet returns=string',
      '  param name=who type=string',
      '  handler lang="kern"',
      '    let name=msg value="who"',
      '    return value="msg"',
    ].join('\n');

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    expect(handler.props?.lang).toBe('kern');
    const types = (handler.children ?? []).map((c) => c.type);
    expect(types).toEqual(['let', 'return']);

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toContain('const msg = who;');
    expect(emitted).toContain('return msg;');
  });

  test('let kind=let round-trips and decompiles re-parseably', () => {
    const src = [
      'fn name=count returns=void',
      '  handler lang="kern"',
      '    let name=total kind=let value=0',
      '    assign target=total op="+=" value=1',
    ].join('\n');

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const letNode = (handler.children ?? [])[0] as IRNode;
    expect(letNode.props).toMatchObject({ name: 'total', kind: 'let', value: '0' });

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toContain('let total = 0;');
    expect(emitted).toContain('total += 1;');

    const text = decompile(letNode).code;
    expect(text).toBe('let name=total value="0" kind=let');
    expect(() =>
      parseDocumentStrict(['fn name=count returns=void', '  handler lang="kern"', `    ${text}`].join('\n')),
    ).not.toThrow();
  });

  // KERN-GAPS gap `var-no-init` — `let name=x type="User | null" kind=let`
  // round-trips through the decompiler. Pre-fix, `renderLet` emitted bare
  // `type=User | null` which the parser tokenised as three separate props.
  // The decompiler now routes through `renderScalarProp` for consistent
  // quoting (Gemini review fix).
  test('let kind=let with complex (space-bearing) type round-trips', () => {
    const src = [
      'fn name=acc returns=void',
      '  handler lang="kern"',
      '    let name=user type="User | null" kind=let',
      '    assign target=user value="loadUser()"',
    ].join('\n');

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const letNode = (handler.children ?? [])[0] as IRNode;
    expect(letNode.props?.name).toBe('user');
    expect(letNode.props?.type).toBe('User | null');
    expect(letNode.props?.kind).toBe('let');

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toContain('let user: User | null;');

    const text = decompile(letNode).code;
    // Quoted because the type carries spaces.
    expect(text).toBe('let name=user type="User | null" kind=let');
    expect(() =>
      parseDocumentStrict(['fn name=acc returns=void', '  handler lang="kern"', `    ${text}`].join('\n')),
    ).not.toThrow();
  });

  // KERN-GAPS gap `var-no-init` — `let name=x kind=let` (no value) round-trips
  // without acquiring a spurious `expr=""` attribute, and emits the same
  // `let x = undefined;` TS body that the migrator promised for `let x;`.
  test('let kind=let without value round-trips bare (no spurious expr=)', () => {
    const src = [
      'fn name=acc returns=void',
      '  handler lang="kern"',
      '    let name=pending kind=let',
      '    assign target=pending value="compute()"',
    ].join('\n');

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const letNode = (handler.children ?? [])[0] as IRNode;
    expect(letNode.props?.name).toBe('pending');
    expect(letNode.props?.kind).toBe('let');
    expect(letNode.props?.value).toBeUndefined();

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toContain('let pending;');

    const text = decompile(letNode).code;
    expect(text).toBe('let name=pending kind=let');
    expect(() =>
      parseDocumentStrict(['fn name=acc returns=void', '  handler lang="kern"', `    ${text}`].join('\n')),
    ).not.toThrow();
  });

  test('body-statement if + sibling else round-trips', () => {
    const src = [
      'fn name=classify returns=string',
      '  param name=n type=number',
      '  handler lang="kern"',
      '    if cond="n > 0"',
      '      return value="\\"positive\\""',
      '    else',
      '      return value="\\"non-positive\\""',
    ].join('\n');

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const types = (handler.children ?? []).map((c) => c.type);
    expect(types).toEqual(['if', 'else']);

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toMatch(/if \(n > 0\) \{/);
    expect(emitted).toContain('return "positive";');
    expect(emitted).toMatch(/\} else \{/);
    expect(emitted).toContain('return "non-positive";');
  });

  test('body-statement try + catch round-trips', () => {
    const src = [
      'fn name=safeRun returns=number',
      '  handler lang="kern"',
      '    try',
      '      let name=x value="42"',
      '      return value="x"',
      '      catch name=e',
      '        return value="0"',
    ].join('\n');

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const tryNode = (handler.children ?? []).find((c) => c.type === 'try');
    expect(tryNode).toBeDefined();
    const tryChildren = (tryNode?.children ?? []).map((c) => c.type);
    expect(tryChildren).toContain('let');
    expect(tryChildren).toContain('return');
    expect(tryChildren).toContain('catch');

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toMatch(/try \{/);
    expect(emitted).toContain('const x = 42;');
    expect(emitted).toMatch(/\} catch \(e\) \{/);
    expect(emitted).toContain('return 0;');
  });

  test('body-statement try + finally parses from source without unknown-node diagnostics', () => {
    const src = [
      'fn name=safeRun returns=number',
      '  handler lang="kern"',
      '    try',
      '      do value="work()"',
      '      finally',
      '        do value="cleanup()"',
    ].join('\n');

    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.code === 'UNKNOWN_NODE_TYPE')).toEqual([]);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

    const handler = findFirstHandler(root);
    const tryNode = (handler.children ?? []).find((c) => c.type === 'try');
    expect(tryNode).toBeDefined();
    const tryChildren = (tryNode?.children ?? []).map((c) => c.type);
    expect(tryChildren).toEqual(['do', 'finally']);

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toBe(['try {', '  work();', '} finally {', '  cleanup();', '}'].join('\n'));
  });

  test('body-statement multi-line with parses from source without unknown-node diagnostics', () => {
    const src = [
      'fn name=ask returns=string',
      '  handler lang="kern"',
      '    with name=session value="spawn()" cleanup="session.close()"',
      '      return value="session.ask(\\"hello\\")"',
    ].join('\n');

    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.code === 'UNKNOWN_NODE_TYPE')).toEqual([]);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

    const handler = findFirstHandler(root);
    const withNode = (handler.children ?? [])[0] as IRNode;
    expect(withNode.type).toBe('with');
    expect((withNode.children ?? []).map((c) => c.type)).toEqual(['return']);

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toContain('const session = spawn();');
    expect(emitted).toContain('return session.ask("hello");');
    expect(emitted).toContain('session.close();');
  });

  test('body-statement throw round-trips', () => {
    const src = ['fn name=fail returns=void', '  handler lang="kern"', '    throw value="new Error(\\"boom\\")"'].join(
      '\n',
    );

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const types = (handler.children ?? []).map((c) => c.type);
    expect(types).toEqual(['throw']);

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toContain('throw new Error("boom");');
  });

  test('body-statement assign round-trips', () => {
    const src = ['fn name=setValue returns=void', '  handler lang="kern"', '    assign target="obj.x" value="1"'].join(
      '\n',
    );

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const types = (handler.children ?? []).map((c) => c.type);
    expect(types).toEqual(['assign']);

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toContain('obj.x = 1;');
  });

  test('body-statement compound assign round-trips and decompiles re-parseably', () => {
    const src = [
      'fn name=setValue returns=void',
      '  handler lang="kern"',
      '    assign target=total op="+=" value="item.value"',
    ].join('\n');

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    expect((handler.children ?? [])[0]?.props).toMatchObject({ target: 'total', op: '+=', value: 'item.value' });
    expect(emitNativeKernBodyTS(handler)).toContain('total += item.value;');

    // Decompile the body statement directly; handler decompile still renders
    // raw `props.code` blocks and intentionally does not reconstruct children.
    const text = decompile((handler.children ?? [])[0] as IRNode).code;
    expect(text).toContain('assign target=total op="+=" value="item.value"');
    expect(() =>
      parseDocumentStrict(['fn name=setValue returns=void', '  handler lang="kern"', `    ${text}`].join('\n')),
    ).not.toThrow();
  });

  // KERN-GAPS gap `expr-stmt-mutation` — postfix `X++;` / `X--;` lifts to a
  // value-less `assign target=X op="++"` form that round-trips to byte-identical
  // TS, decompiles to KERN without a `value=` attr, and lowers to `X += 1` on
  // Python.
  test('body-statement assign op="++" round-trips and decompiles without value=', () => {
    const src = [
      'fn name=tick returns=void',
      '  handler lang="kern"',
      '    let name=count kind=let value=0',
      '    assign target=count op="++"',
      '    assign target=count op="--"',
      '    assign target="obj.foo" op="++"',
    ].join('\n');

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const children = handler.children ?? [];
    expect(children[1]?.props).toMatchObject({ target: 'count', op: '++' });
    expect(children[1]?.props?.value).toBeUndefined();
    expect(children[2]?.props).toMatchObject({ target: 'count', op: '--' });
    expect(children[3]?.props).toMatchObject({ target: 'obj.foo', op: '++' });

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toContain('count++;');
    expect(emitted).toContain('count--;');
    expect(emitted).toContain('obj.foo++;');

    const incText = decompile(children[1] as IRNode).code;
    expect(incText).toBe('assign target=count op="++"');
    expect(incText).not.toContain('value=');
    const memText = decompile(children[3] as IRNode).code;
    expect(memText).toBe('assign target="obj.foo" op="++"');
    expect(() =>
      parseDocumentStrict(
        ['fn name=tick returns=void', '  handler lang="kern"', `    ${incText}`, `    ${memText}`].join('\n'),
      ),
    ).not.toThrow();
  });

  test('body-statement assign op="++" with value= is rejected by schema', () => {
    const src = [
      'fn name=bad returns=void',
      '  handler lang="kern"',
      '    let name=count kind=let value=0',
      '    assign target=count op="++" value="1"',
    ].join('\n');

    expect(() => parseDocumentStrict(src)).toThrow(/value-less|remove the `value=`/);
  });

  test.each(['+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>='])(
    'body-statement compound assign op %s decompiles re-parseably',
    (op) => {
      const text = decompile({ type: 'assign', props: { target: 'value', op, value: 'delta' } }).code;
      expect(text).toBe(`assign target=value op="${op}" value=delta`);
      expect(() =>
        parseDocumentStrict(['fn name=setValue returns=void', '  handler lang="kern"', `    ${text}`].join('\n')),
      ).not.toThrow();
    },
  );

  test('body-statement while round-trips', () => {
    const src = [
      'fn name=drain returns=void',
      '  handler lang="kern"',
      '    while cond="queue.length > 0"',
      '      let name=item value="queue.shift()"',
      '      do value="process(item)"',
    ].join('\n');

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const types = (handler.children ?? []).map((c) => c.type);
    expect(types).toEqual(['while']);

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toContain('while (queue.length > 0) {');
    expect(emitted).toContain('const item = queue.shift();');
    expect(emitted).toContain('process(item);');
  });

  test('body-statement for round-trips and decompiles re-parseably', () => {
    const src = [
      'fn name=visitAll returns=void',
      '  handler lang="kern"',
      '    for name=i from=0 to="List.length(items)" step=2',
      '      do value="visit(items[i])"',
    ].join('\n');

    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const forNode = (handler.children ?? [])[0] as IRNode;
    expect(forNode.type).toBe('for');

    const emitted = emitNativeKernBodyTS(handler);
    expect(emitted).toContain('const __k_for_start_1 = 0;');
    expect(emitted).toContain('const __k_for_end_2 = items.length;');
    expect(emitted).toContain('for (let i = __k_for_start_1; i < __k_for_end_2; i += 2) {');
    expect(emitted).toContain('visit(items[i]);');

    const text = decompile(forNode).code;
    expect(text).toContain('for name=i from=0 to="List.length(items)" step=2');
    const indented = text
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
    expect(() =>
      parseDocumentStrict(['fn name=visitAll returns=void', '  handler lang="kern"', indented].join('\n')),
    ).not.toThrow();
  });

  test('body-statement do decompiles re-parseably', () => {
    const src = ['fn name=touch returns=void', '  handler lang="kern"', '    do value="touch(x)"'].join('\n');
    const root = parseDocumentStrict(src);
    const handler = findFirstHandler(root);
    const doNode = (handler.children ?? [])[0] as IRNode;
    const text = decompile(doNode).code;
    expect(text).toBe('do value="touch(x)"');
    expect(() =>
      parseDocumentStrict(['fn name=touch returns=void', '  handler lang="kern"', `    ${text}`].join('\n')),
    ).not.toThrow();
  });
});

describe('slice 5b-pre — body-statement context validator (negative)', () => {
  test('`return` outside a `handler lang="kern"` scope errors', () => {
    const src = ['fn name=top returns=void', '  return value="1"'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const violation = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe('error');
    expect(violation?.message).toMatch(/`return`/);
  });

  test('`throw` outside scope errors', () => {
    const src = ['fn name=top returns=void', '  throw value="\\"oops\\""'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const violation = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(violation).toBeDefined();
    expect(violation?.message).toMatch(/`throw`/);
  });

  test('`assign` outside scope errors', () => {
    const src = ['fn name=top returns=void', '  assign target="x" value="1"'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const violation = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(violation).toBeDefined();
    expect(violation?.message).toMatch(/`assign`/);
  });

  test('body-statement `if cond=...` outside scope errors', () => {
    const src = ['fn name=top returns=void', '  if cond="true"', '    return value="1"'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const violation = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(violation).toBeDefined();
  });

  test('body-statement `try` (no name) outside scope errors', () => {
    const src = [
      'fn name=top returns=void',
      '  try',
      '    return value="1"',
      '    catch name=e',
      '      return value="0"',
    ].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const violation = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(violation).toBeDefined();
    expect(violation?.message).toMatch(/`try`/);
  });

  test('body-statement `while` outside scope errors', () => {
    const src = ['fn name=top returns=void', '  while cond="running"', '    break'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const violation = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(violation?.message).toMatch(/`while`/);
  });

  test('body-statement `for` outside scope errors', () => {
    const src = ['fn name=top returns=void', '  for name=i from=0 to=10', '    break'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const violation = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(violation?.message).toMatch(/`for`/);
  });

  test('async-orchestration `try name=…` is NOT flagged (different shape)', () => {
    const src = [
      'fn name=loadUser returns=any',
      '  try name=load',
      '    step name=res await="fetch(url)"',
      '    handler <<<',
      '      return res;',
      '    >>>',
    ].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const tryViolation = diagnostics.find(
      (d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER' && d.message.includes('`try`'),
    );
    expect(tryViolation).toBeUndefined();
  });

  test('valid `lang="kern"` handler with body statements has no body-context errors', () => {
    const src = ['fn name=ok returns=number', '  handler lang="kern"', '    return value="1"'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const violation = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(violation).toBeUndefined();
  });

  test('invalid let kind is a parser diagnostic', () => {
    const src = ['fn name=bad returns=void', '  handler lang="kern"', '    let name=x kind=var value=0'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const violation = diagnostics.find((d) => d.code === 'LET_INVALID_KIND');
    expect(violation).toBeDefined();
    expect(violation?.message).toMatch(/`const` or `let`/);
  });
});
