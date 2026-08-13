function nestedStyle(depth) {
  return `${'{ x='.repeat(depth)}1${'}'.repeat(depth)}`;
}

export const VALID_FORMATTER_FIXTURES = Object.freeze([
  { id: 'empty', source: '', expected: '', structural: false },
  {
    id: 'missing-eof-lf-default',
    source: 'fn name=f returns=number   ',
    expected: 'fn name=f returns=number\n',
    structural: true,
  },
  {
    id: 'ordinary-lf-trailing-trivia',
    source: 'fn name=f returns=number   \n  handler lang="kern"\n    return value="1"\n',
    expected: 'fn name=f returns=number\n  handler lang="kern"\n    return value="1"\n',
    structural: true,
  },
  {
    id: 'uniform-crlf',
    source: 'fn name=f returns=number   \r\n  handler lang="kern"\r\n    return value="1"\r\n',
    expected: 'fn name=f returns=number\r\n  handler lang="kern"\r\n    return value="1"\r\n',
    structural: true,
  },
  {
    id: 'comments-and-blank-records',
    source: '# heading  \n\t  \nfn name=f returns=number\n  handler lang="kern"\n    return value="1" // payload  \n',
    expected: '# heading  \n\t  \nfn name=f returns=number\n  handler lang="kern"\n    return value="1" // payload  \n',
    structural: true,
  },
  {
    id: 'raw-fence-precedence',
    source: 'fn name=f returns=string\n  handler <<<\n# // <<< marker and spaces   \nconst value = ">>> not a closer";  \n  >>>\n',
    expected: 'fn name=f returns=string\n  handler <<<\n# // <<< marker and spaces   \nconst value = ">>> not a closer";  \n  >>>\n',
    structural: false,
  },
  {
    id: 'multiline-opaque-quote',
    source: 'fn name=f returns=string\n  handler lang="kern"\n    return value="astral 🚀   \ncontinued"   \n',
    expected: 'fn name=f returns=string\n  handler lang="kern"\n    return value="astral 🚀   \ncontinued"   \n',
    structural: false,
  },
  {
    id: 'multiline-expression',
    source: 'component name=Demo\n  text value="{{ first   \nsecond }}"   \n',
    expected: 'component name=Demo\n  text value="{{ first   \nsecond }}"   \n',
    structural: false,
  },
  {
    id: 'quoted-markers',
    source: 'component name=Demo\n  text value="# // <<< {{ { literal"   \n',
    expected: 'component name=Demo\n  text value="# // <<< {{ { literal"\n',
    structural: false,
  },
  {
    id: 'comment-markers-require-horizontal-boundary',
    source: 'resource uri=https://example.com/path   \nconst name=a#b   \n',
    expected: 'resource uri=https://example.com/path\nconst name=a#b\n',
    structural: false,
  },
  {
    id: 'nested-style-keeps-raw-marker-opaque',
    source: 'component name=Demo { outer={ inner=1 } value=<<<   }\n',
    expected: 'component name=Demo { outer={ inner=1 } value=<<<   }\n',
    structural: false,
  },
  {
    id: 'exact-style-depth',
    source: `component name=Demo ${nestedStyle(64)}   \n`,
    expected: `component name=Demo ${nestedStyle(64)}\n`,
    structural: false,
  },
]);

export const INVALID_FORMATTER_FIXTURES = Object.freeze([
  { id: 'mixed-terminators', source: 'x\ny\r\n', code: 'MIXED_TERMINATORS' },
  { id: 'bare-cr', source: 'x\ry', code: 'BARE_CR' },
  { id: 'unterminated-raw', source: 'handler <<<\nbody\n', code: 'UNTERMINATED_RAW' },
  { id: 'unterminated-quote', source: 'text value="open\n', code: 'UNTERMINATED_QUOTE' },
  { id: 'unterminated-expression', source: 'text value={{ open\n', code: 'UNTERMINATED_EXPRESSION' },
  { id: 'unterminated-style', source: 'style { color=red\n', code: 'UNTERMINATED_STYLE' },
  { id: 'unterminated-outer-style', source: 'style { outer={ color=red }\n', code: 'UNTERMINATED_STYLE' },
  {
    id: 'lexical-depth-limit',
    source: `text value=${'{{'.repeat(65)}x${'}}'.repeat(65)}\n`,
    code: 'LEXICAL_DEPTH_LIMIT',
  },
  {
    id: 'style-depth-limit',
    source: `component name=Demo ${nestedStyle(65)}\n`,
    code: 'LEXICAL_DEPTH_LIMIT',
  },
]);
