export const BUILTIN_ATTESTATION_FIXTURES = Object.freeze([
  { id: 'builtin-first', source: 'screen name=home' },
  { id: 'builtin-middle', source: 'fn name=run' },
  { id: 'builtin-last', source: 'expression-v1 value=ok' },
  { id: 'normalized-builtin', source: 'evolved:text value=hello' },
  { id: 'unresolved-name', source: 'mystery value=1' },
  { id: 'unresolved-case', source: 'Text value=1' },
  { id: 'unresolved-prefix', source: 'textual value=1' },
  { id: 'unresolved-suffix', source: 'mytext value=1' },
  { id: 'unresolved-reserved', source: 'tuple value=1' },
  { id: 'unresolved-unicode-normalized-token', source: 'evolved:widget value=1' },
  { id: 'dropped-whitespace', source: '  text value=1' },
  { id: 'dropped-symbol', source: '@ text value=1' },
  { id: 'comment-retained-builtin', source: 'route path=/ # payload' },
  { id: 'quoted-drop-astral', source: '"😀" text # payload' },
]);

export const MUTABLE_REGISTRY_NAMES = Object.freeze({
  dynamic: 'm4161dynamic',
  multiline: 'm4161multiline',
  template: 'm4161template',
});
