export const PARITY_FIXTURES = [
  { id: 'empty', source: '' },
  { id: 'declaration', source: 'fn name=main returns=string' },
  { id: 'all-simple-kinds', source: 'name = "value", $theme /path/part @' },
  {
    id: 'ascii-control-and-del',
    source: [...Array.from({ length: 32 }, (_, codePoint) => codePoint), 0x7f]
      .map((codePoint) => String.fromCodePoint(codePoint))
      .join(''),
  },
  { id: 'single-quoted-escapes', source: "'can\\'t\\\\stop'" },
  { id: 'double-quoted-escapes', source: '"say \\"hi\\" and \\\\"' },
  { id: 'nested-expression', source: '{{ outer({{ inner }}) }} tail' },
  { id: 'expression-nbsp-trim', source: '{{\u00a0value\u00a0}}' },
  { id: 'expression-ideographic-space-trim', source: '{{\u3000value\u3000}}' },
  { id: 'expression-bom-trim', source: '{{\ufeffvalue\ufeff}}' },
  { id: 'style-quotes', source: '{ color: "red}blue", escaped: \\} } tail' },
  { id: 'numeric-family', source: '0 1_000 1.25 .5 0xFF 0b10_01 0o77 99n 1.2n' },
  { id: 'invalid-prefix-number', source: '0x 0b_1 0o8' },
  { id: 'evolved-identifier', source: 'evolved:keyword evolved: evolved:name-with-dash' },
  { id: 'unicode-aggregates', source: '"é中😀" {{ é中😀 }} { value: "😀" } /é/中/😀 tail' },
  { id: 'unclosed-expression', source: 'before {{ never closes' },
  { id: 'unclosed-style', source: 'before { never closes' },
  { id: 'unclosed-string-double', source: 'before "never closes' },
  { id: 'unclosed-string-single', source: "before 'never closes" },
];

export const EXCLUDED_FIXTURES = [
  { id: 'unclosed-expression-terminal-astral', source: '{{😀', code: 'UNSUPPORTED_UTF16_SLICE' },
  { id: 'standalone-two-byte-unknown', source: 'é', code: 'UNSUPPORTED_UNKNOWN' },
  { id: 'standalone-three-byte-unknown', source: '中', code: 'UNSUPPORTED_UNKNOWN' },
  { id: 'standalone-four-byte-unknown', source: '😀', code: 'UNSUPPORTED_UNKNOWN' },
  { id: 'malformed-leading-surrogate', source: '\ud800', code: 'MALFORMED_UTF16' },
  { id: 'malformed-trailing-surrogate', source: '\udc00', code: 'MALFORMED_UTF16' },
];

export function generatedParitySources(maxCases) {
  const atoms = [
    'alpha',
    '_private-2',
    '42',
    '0xCA_FE',
    '"é"',
    "'中'",
    '{{ 😀 }}',
    '{ value: "é中😀" }',
    '$theme-name',
    '/é/中/😀',
    '=',
    ',',
    '@',
  ];
  const separators = [' ', '\t', '  '];
  const cases = [];
  for (let left = 0; left < atoms.length && cases.length < maxCases; left += 1) {
    for (let right = 0; right < atoms.length && cases.length < maxCases; right += 1) {
      cases.push(`${atoms[left]}${separators[(left + right) % separators.length]}${atoms[right]}`);
    }
  }
  return cases;
}
