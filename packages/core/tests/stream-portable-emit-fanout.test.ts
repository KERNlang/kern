/** SPEC — slice 4c streaming surface: `emit` + `fanout` + portable `stream` body.
 *
 * A backend SSE route's body may now be portable nodes instead of a raw
 * `<<<JS>>>` handler. `emit value={{ e }}` pushes one event; `fanout name=x
 * in=xs` runs each iteration concurrently and merges every emitted event into
 * the one stream. This file pins the core contract: parse/validate accept the
 * portable stream body, schema `allowedChildren` admits the new nodes, and the
 * `emit-fanout-require-stream` semantic rule rejects them anywhere else.
 *
 * Codegen (Express/Python lowering) is asserted in the target packages.
 */

import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { validateSchema } from '../src/schema.js';
import { validateSemantics } from '../src/semantic-validator.js';

const REVIEW_STREAM = [
  'server name=API',
  '  route method=post path=/api/review',
  '    schema body="{diff: string}"',
  '    stream',
  '      derive expanded expr={{ registry.expandInstances() }}',
  '      fanout name=config in=expanded',
  '        let adapter value="registry.getAdapter(config.id)"',
  '        each await=true name=event in={{ adapter.stream(config) }}',
  '          emit value={{ event }}',
].join('\n');

describe('emit / fanout — parser + schema + semantics', () => {
  test('the full fan-out stream body parses with no error diagnostics', () => {
    const { diagnostics } = parseDocumentWithDiagnostics(REVIEW_STREAM);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  test('emit/fanout are first-class node types — no UNKNOWN_NODE_TYPE warnings', () => {
    // Registered in NODE_SCHEMAS *and* the NODE_TYPES list `isKnownNodeType`
    // checks; otherwise both nodes surface as parser warnings (Codex review).
    const { diagnostics } = parseDocumentWithDiagnostics(REVIEW_STREAM);
    const unknown = diagnostics.filter((d) => d.code === 'UNKNOWN_NODE_TYPE' && /emit|fanout/.test(d.message));
    expect(unknown).toEqual([]);
  });

  test('respond/guard nested anywhere inside a stream is rejected (no mid-stream HTTP response)', () => {
    const src = [
      'server name=API',
      '  route method=post path=/api/x',
      '    stream',
      '      each await=true name=t in=ticks',
      '        respond 200 json={{ t }}',
    ].join('\n');
    const { root } = parseDocumentWithDiagnostics(src);
    const v = validateSemantics(root).find((x) => x.rule === 'no-http-response-in-stream');
    expect(v?.nodeType).toBe('respond');
    // A guard/respond as a route SIBLING of the stream stays valid (not flagged).
    const ok = [
      'server name=API',
      '  route method=post path=/api/y',
      '    guard expr={{ body.ok }} else=400 message="bad"',
      '    stream',
      '      each await=true name=t in=ticks',
      '        emit value={{ t }}',
    ].join('\n');
    const okRoot = parseDocumentWithDiagnostics(ok).root;
    expect(validateSemantics(okRoot).filter((x) => x.rule === 'no-http-response-in-stream')).toEqual([]);
  });

  test('schema admits fanout/emit/derive under stream and each/emit under fanout', () => {
    const { root } = parseDocumentWithDiagnostics(REVIEW_STREAM);
    const violations = validateSchema(root);
    expect(
      violations.filter((v) => /does not allow child type '(emit|fanout|derive|each|let)'/.test(v.message)),
    ).toEqual([]);
  });

  test('passes semantic validation (emit/fanout have a stream ancestor)', () => {
    const { root } = parseDocumentWithDiagnostics(REVIEW_STREAM);
    const violations = validateSemantics(root);
    expect(violations.filter((v) => v.rule === 'emit-fanout-require-stream')).toEqual([]);
  });

  test('emit outside a stream is rejected by the semantic rule', () => {
    const src = [
      'server name=API',
      '  route method=post path=/api/x',
      '    derive items expr={{ store.all() }}',
      '    emit value={{ items }}',
    ].join('\n');
    const { root } = parseDocumentWithDiagnostics(src);
    const violations = validateSemantics(root);
    const v = violations.find((x) => x.rule === 'emit-fanout-require-stream');
    expect(v?.nodeType).toBe('emit');
    expect(v?.message).toMatch(/respond/);
  });

  test('fanout outside a stream is rejected by the semantic rule', () => {
    const src = [
      'server name=API',
      '  route method=post path=/api/x',
      '    derive items expr={{ store.all() }}',
      '    fanout name=item in=items',
      '      do value="item.touch()"',
    ].join('\n');
    const { root } = parseDocumentWithDiagnostics(src);
    const violations = validateSemantics(root);
    const v = violations.find((x) => x.rule === 'emit-fanout-require-stream');
    expect(v?.nodeType).toBe('fanout');
    expect(v?.message).toMatch(/each/);
  });

  test('emit nested inside fanout > each still satisfies the stream-ancestor rule', () => {
    const { root } = parseDocumentWithDiagnostics(REVIEW_STREAM);
    const violations = validateSemantics(root);
    // The emit is three levels below `stream` (stream > fanout > each > emit);
    // the rule walks the whole ancestry, not just the immediate parent.
    expect(violations.some((v) => v.rule === 'emit-fanout-require-stream')).toBe(false);
  });

  test('emit requires a value prop; fanout requires name and in', () => {
    const src = [
      'server name=API',
      '  route method=post path=/api/x',
      '    stream',
      '      fanout in=items',
      '        emit event="message"',
    ].join('\n');
    const { root } = parseDocumentWithDiagnostics(src);
    const violations = validateSchema(root);
    expect(violations.some((v) => /emit/.test(v.message) && /value/.test(v.message))).toBe(true);
    expect(violations.some((v) => /fanout/.test(v.message) && /name/.test(v.message))).toBe(true);
  });

  test('a `let` directly under `stream` (generator-scope binding) is allowed', () => {
    // Codex P2: schema + both codegens accept a direct stream `let`; the
    // let-must-be-inside-each rule must approve `stream` as a parent too.
    const src = [
      'server name=API',
      '  route method=get path=/api/ticks',
      '    stream',
      '      let name=count kind=let value="0"',
      '      each await=true name=t in=ticks',
      '        emit value={{ t }}',
    ].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(validateSemantics(root).filter((v) => v.rule === 'let-must-be-inside-each')).toEqual([]);
  });

  test('a plain (sequential) stream body with derive + emit is also valid', () => {
    const src = [
      'server name=API',
      '  route method=get path=/api/ticks',
      '    stream',
      '      derive ticks expr={{ clock.ticks() }}',
      '      each await=true name=t in=ticks',
      '        emit value={{ t }}',
    ].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(validateSemantics(root).filter((v) => v.rule === 'emit-fanout-require-stream')).toEqual([]);
  });
});
