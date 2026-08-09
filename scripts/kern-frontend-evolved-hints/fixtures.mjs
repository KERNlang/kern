export const EVOLVED_HINT_FIXTURES = Object.freeze([
  {
    id: 'runtime-positional-bare',
    source: 'widget "x" bob p=1 {c:red} $dark stray',
    type: 'widget',
    hints: { positionalArgs: ['first'], bareWord: 'name' },
  },
  {
    id: 'runtime-two-positionals',
    source: 'widget "x" bob p=1 {c:red} $dark stray',
    type: 'widget',
    hints: { positionalArgs: ['left', 'right'] },
  },
  {
    id: 'builtin-class-fallback',
    source: 'class NativeClass p=1 stray',
    type: 'class',
  },
  {
    id: 'empty-runtime-suppresses-builtin',
    source: 'class NativeClass p=1 stray',
    type: 'class',
    hints: {},
  },
  {
    id: 'bare-key-value-guard',
    source: 'widget p=1 stray',
    type: 'widget',
    hints: { bareWord: 'name' },
  },
  {
    id: 'arbitrary-positional-kinds',
    source: 'widget {c:red} $dark {{x}} p=1 stray',
    type: 'widget',
    hints: { positionalArgs: ['styleArg', 'themeArg', 'exprArg'] },
  },
  {
    id: 'missing-positionals',
    source: 'widget "x"',
    type: 'widget',
    hints: { positionalArgs: ['first', 'missing'], bareWord: 'name' },
  },
  {
    id: 'write-overwrite-order',
    source: 'widget one two three p=1',
    type: 'widget',
    hints: { positionalArgs: ['name', 'name'], bareWord: 'name' },
  },
  {
    id: 'single-bare-word',
    source: 'widget one two p=1',
    type: 'widget',
    hints: { bareWord: 'name' },
  },
  {
    id: 'absent-nonclass',
    source: 'widget one p=1',
    type: 'widget',
  },
  {
    id: 'positional-key-value-head',
    source: 'widget p=1',
    type: 'widget',
    hints: { positionalArgs: ['first'] },
  },
  {
    id: 'astral-width',
    source: 'widget "😀" first stray p=1',
    type: 'widget',
    hints: { positionalArgs: ['emoji'], bareWord: 'name' },
  },
]);
