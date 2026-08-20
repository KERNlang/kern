export const FIXTURES = {
  simpleLf: 'fn main\n  let x = 1\n  return x\n',
  simpleCrlf: 'fn main\r\n  let x = 1\r\n  return x\r\n',
  astralSource: 'fn greet\n  let msg = "Hello 🌍 🚀"\n  return msg\n',
  blankAndComments: '# Top comment\n\nfn main\n  # Nested comment\n\n  let x = 1\n  // another comment\n  return x\n',
  quoteContinuation: 'fn doc\n  let text = "first line\nsecond line\nthird line"\n  return text\n',
  exprContinuation: 'fn math\n  let val = {{ 1 +\n  2 +\n  3 }}\n  return val\n',
  tabIndent: 'fn main\n\tlet x = 1\n\treturn x\n',
  indentJump: 'fn outer\n    let a = 1\n  let b = 2\n',
  decoratorCandidate: '@logged\n@trace\nfn compute\n  return 42\n',
  decoratorOrphanEof: 'fn outer\n  let a = 1\n@orphan\n',
  decoratorOrphanIndent: '@logged\n  fn inner\n    return 1\n',
  decoratorMultiRun: '@dec1\nfn first\n  return 1\n@dec2\n@dec3\nfn second\n  return 2\n',
  inlineRawBlock: 'handler lang="kern" <<< return 1 >>>\n',
  multilineRawBlock: 'doc <<<\nDocumentation body\nspanning lines\n>>>\nfn next\n  return 0\n',
  droppedLine: '123 not an identifier\nfn valid\n  return 1\n',
  deepTree: 'root\n  c1\n    c11\n      c111\n        c1111\n  c2\n    c21\n',
  complexMixed: '@route path="/api"\nfn handle\n  let title = "Complex 🚀"\n  let query = {{ id +\n  10 }}\n  handler lang="kern" <<<\n    return title\n  >>>\n  return query\n',
};

export const ROLE_SUBSTITUTION_PAIRS = [
  {
    name: 'fn vs let successor',
    sourceA: '@cached\nfn  perform\n  return 1\n',
    sourceB: '@cached\nlet perform\n  return 1\n',
  },
  {
    name: 'fn vs type successor',
    sourceA: '@spec\nfn   DataNode\n  return 1\n',
    sourceB: '@spec\ntype DataNode\n  return 1\n',
  },
  {
    name: 'fn vs unknown keyword successor',
    sourceA: '@rule\nfn     customHook\n  return 1\n',
    sourceB: '@rule\ncustom customHook\n  return 1\n',
  },
  {
    name: 'modifier-prefixed successor opacity',
    sourceA: '@logged\npublic fn Task\n  return 1\n',
    sourceB: '@logged\nexport fn Task\n  return 1\n',
  },
  {
    name: 'successor suffix opacity',
    sourceA: '@opaque\nfn name=a\n  return 1\n',
    sourceB: '@opaque\nfn mode=b\n  return 1\n',
  },
];
