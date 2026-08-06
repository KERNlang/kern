export const NODE_TYPE_TOKEN_ADMISSION_FIXTURES = Object.freeze([
  { id: 'plain-identifier', source: 'text value=ok' },
  { id: 'unknown-identifier-admits', source: 'mystery value=ok' },
  { id: 'evolved-normalized', source: 'evolved:name value=1' },
  { id: 'unicode-identifier', source: 'café value=ok' },
  { id: 'hash-boundary', source: 'screen # payload😀' },
  { id: 'slash-boundary', source: 'view\t// payload' },
  { id: 'identifier-with-diagnostic', source: 'text value="open' },
  { id: 'number-zero', source: '123 text' },
  { id: 'quoted-zero', source: '"text" value=ok' },
  { id: 'style-zero', source: '{ color:red } text' },
  { id: 'expression-zero', source: '{{ value }} text' },
  { id: 'comma-zero', source: ', text' },
  { id: 'equals-zero', source: '= text' },
  { id: 'slash-zero', source: '/path text' },
  { id: 'theme-zero', source: '$brand text' },
  { id: 'unknown-zero', source: '@ text' },
  { id: 'leading-whitespace-no-skip', source: '  text value=ok' },
  { id: 'unicode-drop-coordinates', source: '"😀" text # discarded' },
]);

export const INHERITED_ADMISSION_FAILURE_FIXTURES = Object.freeze([
  { code: 'EMPTY_RETAINED_CODE', id: 'empty', source: '' },
  { code: 'EMPTY_RETAINED_CODE', id: 'ascii-whitespace', source: ' \t ' },
  { code: 'EMPTY_RETAINED_CODE', id: 'comment-only', source: ' # payload' },
  { code: 'UNSUPPORTED_UNKNOWN', id: 'non-ascii-whitespace', source: '\u00a0' },
]);
