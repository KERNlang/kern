export const PARITY_FIXTURES = [
  { id: 'empty', source: '' },
  { id: 'single-complete', source: 'text value="ok"' },
  { id: 'terminal-lf', source: 'text value="ok"\n' },
  { id: 'blank-tape', source: '\n \n\t\n' },
  { id: 'indent-bytes', source: '\t  text value="ok"' },
  { id: 'multibyte', source: 'text value="Grüezi 😀"' },
  { id: 'multiline-quote', source: 'method params="payload:{\n  id: string;\n}" returns=void' },
  { id: 'escaped-quote', source: 'text value="foo \\"bar\\"\nbaz"' },
  { id: 'multiline-expression', source: 'button disabled={{\n  ready || pending\n}}' },
  { id: 'nested-expression', source: 'text value={{\n  outer({{\n    inner\n  }})\n}}' },
  { id: 'style-quote-brace-comment', source: 'text { content: "# // {{ }}" } value="one\ntwo"' },
  { id: 'inline-comment', source: 'text value="one\ntwo" # done' },
  { id: 'comment-boundary-hash', source: 'text value="open\n# boundary\nclose"' },
  { id: 'comment-boundary-slash', source: 'text value={{\n// boundary\n}}' },
  { id: 'unicode-comment-boundary', source: 'text value="open\n\u00a0# boundary\nclose"' },
  { id: 'raw-boundary', source: 'text value="open\n  handler <<<\n    return 1\n  >>>' },
  { id: 'unicode-raw-boundary', source: 'text value="open\n\u2003handler\u202f<<<\nclose"' },
  { id: 'raw-quoted-fence-not-boundary', source: 'text value="open\nhandler title="my <<< title"\nclose"' },
  { id: 'eof-unclosed-quote', source: 'text value="open\nstill open' },
  { id: 'eof-unclosed-expression', source: 'text value={{\nstillOpen' },
  { id: 'single-quote-no-continuation', source: "text value='open\nnext" },
];

export const REJECTION_FIXTURES = [
  { code: 'UNSUPPORTED_LINE_ENDING', id: 'cr', source: 'x\ry' },
  { code: 'UNSUPPORTED_LINE_ENDING', id: 'crlf', source: 'x\r\ny' },
];
