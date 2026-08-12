import { KernRuntime } from '../../packages/core/dist/runtime-state.js';

export const SUCCESSFUL_LINE_FIXTURES = Object.freeze([
  Object.freeze({
    id: 'combined-route',
    parserHints: Object.freeze({ positionalArgs: Object.freeze(['slot']) }),
    raw: '  route hint GET /🚀 method=post label="launch 🚀" {bg:red,:press:fg:white} $base $accent stray # note',
    semanticContent: 'route hint GET /🚀 method=post label="launch 🚀" {bg:red,:press:fg:white} $base $accent stray',
    expected: Object.freeze({
      indent: 2,
      rawLength: 93,
      type: 'route',
      props: Object.freeze({ slot: 'hint', method: 'post', path: '/🚀', label: 'launch 🚀' }),
      quotedProps: Object.freeze(['label']),
      styles: Object.freeze({ bg: 'red' }),
      pseudoStyles: Object.freeze({ press: Object.freeze({ fg: 'white' }) }),
      themeRefs: Object.freeze(['base', 'accent']),
      loc: Object.freeze({ line: 1, col: 3, endLine: 1, endCol: 96 }),
    }),
    expectedDiagnostics: Object.freeze([
      Object.freeze({
        category: 'parser', code: 'DUPLICATE_PROP', col: 22, endCol: 28, line: 1,
        message: "Duplicate property 'method' at line 1", severity: 'warning',
        suggestion: 'Remove the duplicate property or merge the values into a single prop assignment.',
      }),
      Object.freeze({
        category: 'parser', code: 'UNEXPECTED_TOKEN', col: 91, endCol: 96, line: 1,
        message: 'Unexpected token "stray" at line 1:91', severity: 'warning',
        suggestion: 'Remove the stray token or quote it so the parser can treat it as a value.',
      }),
    ]),
  }),
  Object.freeze({
    id: 'export-fn',
    raw: '    export fn greet(name: string): Result<string> async=true # public',
    semanticContent: 'fn greet(name: string): Result<string> async=true',
    expected: Object.freeze({
      indent: 4,
      rawLength: 56,
      type: 'fn',
      props: Object.freeze({
        export: true,
        name: 'greet',
        params: 'name:string',
        returns: 'Result<string>',
        async: true,
        __firstClassSyntax: true,
      }),
      styles: Object.freeze({}),
      pseudoStyles: Object.freeze({}),
      themeRefs: Object.freeze([]),
      loc: Object.freeze({ line: 1, col: 12, endLine: 1, endCol: 61 }),
    }),
    expectedDiagnostics: Object.freeze([]),
  }),
  Object.freeze({
    id: 'export-fn-diagnostics',
    raw: '  export fn name=legacy returns=void stray value="unterminated',
    semanticContent: 'fn name=legacy returns=void stray value="unterminated',
    expected: Object.freeze({
      indent: 2,
      rawLength: 60,
      type: 'fn',
      props: Object.freeze({ export: true, name: 'legacy', returns: 'void', value: 'unterminated' }),
      quotedProps: Object.freeze(['value']),
      styles: Object.freeze({}),
      pseudoStyles: Object.freeze({}),
      themeRefs: Object.freeze([]),
      loc: Object.freeze({ line: 1, col: 10, endLine: 1, endCol: 63 }),
    }),
    expectedDiagnostics: Object.freeze([
      Object.freeze({
        category: 'parser', code: 'UNCLOSED_STRING', col: 50, endCol: 51, line: 1,
        message: 'Unclosed quoted string at column 41', severity: 'error',
        suggestion: 'Add the missing closing quote or escape any embedded quotes inside the string.',
      }),
      Object.freeze({
        category: 'parser', code: 'UNEXPECTED_TOKEN', col: 38, endCol: 43, line: 1,
        message: 'Unexpected token "stray" at line 1:38', severity: 'warning',
        suggestion: 'Remove the stray token or quote it so the parser can treat it as a value.',
      }),
    ]),
  }),
  Object.freeze({
    id: 'unknown-node-warning',
    raw: '  widget p=1',
    semanticContent: 'widget p=1',
    expected: Object.freeze({
      indent: 2,
      rawLength: 10,
      type: 'widget',
      props: Object.freeze({ p: '1' }),
      styles: Object.freeze({}),
      pseudoStyles: Object.freeze({}),
      themeRefs: Object.freeze([]),
      loc: Object.freeze({ line: 1, col: 3, endLine: 1, endCol: 13 }),
    }),
    expectedDiagnostics: Object.freeze([Object.freeze({
      category: 'parser', code: 'UNKNOWN_NODE_TYPE', col: 3, endCol: 9, line: 1,
      message: "Unknown node type 'widget' at line 1", severity: 'warning',
      suggestion: 'Rename this node to a supported KERN keyword or register it as an evolved node type.',
    })]),
  }),
  Object.freeze({
    id: 'tokenizer-unclosed-string',
    raw: '  text value="unterminated',
    semanticContent: 'text value="unterminated',
    expected: Object.freeze({
      indent: 2,
      rawLength: 24,
      type: 'text',
      props: Object.freeze({ value: 'unterminated' }),
      quotedProps: Object.freeze(['value']),
      styles: Object.freeze({}),
      pseudoStyles: Object.freeze({}),
      themeRefs: Object.freeze([]),
      loc: Object.freeze({ line: 1, col: 3, endLine: 1, endCol: 27 }),
    }),
    expectedDiagnostics: Object.freeze([Object.freeze({
      category: 'parser', code: 'UNCLOSED_STRING', col: 14, endCol: 15, line: 1,
      message: 'Unclosed quoted string at column 12', severity: 'error',
      suggestion: 'Add the missing closing quote or escape any embedded quotes inside the string.',
    })]),
  }),
]);

export function runtimeForSuccessfulLineFixture(fixture) {
  const runtime = new KernRuntime();
  if (fixture.parserHints !== undefined) {
    runtime.registerParserHints(fixture.expected.type, fixture.parserHints);
  }
  return runtime;
}
