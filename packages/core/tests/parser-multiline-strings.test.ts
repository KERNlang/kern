import { parseDocumentWithDiagnostics, parseWithDiagnostics, tokenizeLine } from '../src/parser.js';

describe('Parser multi-line quoted strings', () => {
  test('multi-line quoted props roundtrip through parse', () => {
    const source = [
      'class name=ReadinessBroadcaster',
      '  method name=notify params="payload:{',
      '    ready: boolean;',
      '    detail: string;',
      '  }" returns=void',
    ].join('\n');

    const { root, diagnostics } = parseDocumentWithDiagnostics(source);
    const method = root.children?.[0]?.children?.[0];

    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(method?.props?.params).toBe('payload:{\n    ready: boolean;\n    detail: string;\n  }');
    expect(method?.props?.returns).toBe('void');
  });

  test('UNCLOSED_STRING fires at EOF when a stitched string never closes', () => {
    const { diagnostics } = parseWithDiagnostics(['method name=broken params="payload:{', '  id: string;'].join('\n'));
    const unclosed = diagnostics.find((d) => d.code === 'UNCLOSED_STRING');

    expect(unclosed).toBeDefined();
    expect(unclosed?.line).toBe(1);
  });

  // A `#`-starting physical line is a file-level comment in the outer parse
  // loop — the stitcher refuses to absorb one into a runaway quote. This
  // closes the "comment content can close an unterminated string" injection
  // vector without penalising well-formed multi-line type annotations
  // (those never start a line with `#`).
  test('# starting a physical line halts stitching (defensive)', () => {
    const { diagnostics } = parseWithDiagnostics(['text value="alpha', '# still text', 'omega"'].join('\n'));

    expect(diagnostics.some((d) => d.code === 'UNCLOSED_STRING')).toBe(true);
  });

  test('single-line quoted props keep tokenizer output', () => {
    expect(tokenizeLine('class name="Foo" type="Map<string, User>"')).toEqual([
      { kind: 'identifier', value: 'class', pos: 0 },
      { kind: 'whitespace', value: ' ', pos: 5 },
      { kind: 'identifier', value: 'name', pos: 6 },
      { kind: 'equals', value: '=', pos: 10 },
      { kind: 'quoted', value: 'Foo', pos: 11 },
      { kind: 'whitespace', value: ' ', pos: 16 },
      { kind: 'identifier', value: 'type', pos: 17 },
      { kind: 'equals', value: '=', pos: 21 },
      { kind: 'quoted', value: 'Map<string, User>', pos: 22 },
    ]);
    expect(tokenizeLine('method returns="Promise<void>"')).toEqual([
      { kind: 'identifier', value: 'method', pos: 0 },
      { kind: 'whitespace', value: ' ', pos: 6 },
      { kind: 'identifier', value: 'returns', pos: 7 },
      { kind: 'equals', value: '=', pos: 14 },
      { kind: 'quoted', value: 'Promise<void>', pos: 15 },
    ]);
  });

  test('handler blocks are parsed before string stitching', () => {
    const source = ['fn name=demo', '  handler <<<', '    const value = "unterminated on purpose;', '  >>>'].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(source);
    const handler = root.children?.[0]?.children?.[0];

    expect(diagnostics.some((d) => d.code === 'UNCLOSED_STRING')).toBe(false);
    expect(handler?.props?.code).toContain('const value = "unterminated on purpose;');
  });

  test('comments after the closing quote are still stripped', () => {
    const { root, diagnostics } = parseWithDiagnostics(
      ['method name=load params="foo', 'bar"  # real comment'].join('\n'),
    );

    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(root.props?.params).toBe('foo\nbar');
  });

  test('quotes in expressions, styles, and escaped string content do not confuse stitching', () => {
    const source = [
      'text value="foo \\"bar\\"',
      'baz"',
      'text value={{ "inside expr" }} label="first',
      'second"',
      'text { color: "red" } value="one',
      'two"',
    ].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(source);
    const nodes = root.children ?? [];

    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(nodes[0].props?.value).toBe('foo "bar"\nbaz');
    expect(nodes[1].props?.label).toBe('first\nsecond');
    expect(nodes[2].props?.value).toBe('one\ntwo');
  });

  // Red-team regression (tribunal found #1, sev 5): an unterminated quote
  // followed by `handler <<<` must NOT swallow the handler block. The string
  // is truncated at the block boundary; UNCLOSED_STRING fires; the handler
  // survives as a real block child.
  test('unterminated quote does not swallow a following handler block', () => {
    const source = [
      'fn name=run',
      '  method name=x params="oops',
      '    handler <<<',
      '      chargeCard(userId);',
      '    >>>',
    ].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(source);
    const fn = root.children?.[0];
    const method = fn?.children?.[0];
    const handler = method?.children?.[0];

    expect(diagnostics.some((d) => d.code === 'UNCLOSED_STRING')).toBe(true);
    expect(handler?.type).toBe('handler');
    expect(handler?.props?.code).toContain('chargeCard(userId);');
  });

  // Red-team regression (tribunal found #7, sev 4): an unterminated quote
  // must not absorb a comment line whose content happens to close the quote,
  // which would silently inject replacement props onto the outer node.
  test('unterminated quote does not swallow a comment line', () => {
    const source = ['fn name=charge params="userId', '  # " name=deleteAll auth=none'].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(source);
    const fn = root.children?.[0];

    expect(diagnostics.some((d) => d.code === 'UNCLOSED_STRING')).toBe(true);
    expect(fn?.props?.name).toBe('charge');
    expect(fn?.props?.auth).toBeUndefined();
  });
});
