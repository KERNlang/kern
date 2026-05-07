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

  test.each([
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '**=',
    '&=',
    '|=',
    '^=',
    '<<=',
    '>>=',
  ])('body-statement compound assign op %s decompiles re-parseably', (op) => {
    const text = decompile({ type: 'assign', props: { target: 'value', op, value: 'delta' } }).code;
    expect(text).toBe(`assign target=value op="${op}" value=delta`);
    expect(() =>
      parseDocumentStrict(['fn name=setValue returns=void', '  handler lang="kern"', `    ${text}`].join('\n')),
    ).not.toThrow();
  });

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
});
