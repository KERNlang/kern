export const VALID_FIXTURES = Object.freeze([
  { id: 'empty', source: '' },
  { id: 'tokens', source: 'view name=Home, /route $theme\n' },
  { id: 'numbers', source: '1 0x1f 0b10 0o7 4.2 5n .5\n' },
  { id: 'comments', source: '# full\r\nurl=http://x // tail\n' },
  { id: 'quotes', source: 'text value="a\\"b" other=\'c\\\'d\'\n' },
  { id: 'quote-continuation', source: 'text value="first\r\nsecond"\ntext value=\'third\nfourth\'\n' },
  { id: 'quote-middle', source: 'text value="first\nmiddle\nlast"\n' },
  { id: 'expression', source: 'text value={{ call("}}", {{ nested }}) }}\n' },
  { id: 'expression-continuation', source: 'text value={{ first\r\nmiddle\nlast }}\n' },
  { id: 'style-quote', source: 'view { content:"}" color:red }\n' },
  { id: 'fence-inline', source: 'handler <<<const x = "😀";>>>\n' },
  { id: 'fence-lines', source: 'handler <<<\r\n  raw 😀\r\n  >>>\n' },
  { id: 'unknown', source: '\uFEFF@decorator\rbare\r\n' },
]);

export const FAILURE_FIXTURES = Object.freeze([
  { code: 'UNCLOSED_STYLE', id: 'style-newline', source: 'view { color:red\nnext\n' },
  { code: 'UNCLOSED_STRING', id: 'quote-eof', source: 'text value="open' },
  { code: 'UNCLOSED_EXPR', id: 'expr-eof', source: 'text value={{ open' },
  { code: 'UNEXPECTED_TOKEN', id: 'fence-eof', source: 'handler <<<open' },
]);
