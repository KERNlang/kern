export const SCHEMA_VERSION = 1;

export const UNREADABLE_SOURCE = Symbol('selfhost-validator-unreadable-source');

const BASE = '/virtual/selfhost-validator';
const OUTSIDE = '/virtual/outside-selfhost-validator';

function fixture(id, moduleSpecs, resolutions = [], options = {}) {
  const root = `${BASE}/${id}`;
  const modules = moduleSpecs.map((mod) => ({
    path: `${root}/${mod.path}`,
    root,
    source: mod.source,
  }));
  return {
    id,
    why: options.why ?? id,
    schemaVersion: options.schemaVersion ?? SCHEMA_VERSION,
    shuffleRows: options.shuffleRows === true,
    modules,
    resolutions: resolutions.map((resolution) => ({
      importer: `${root}/${resolution.importer}`,
      specifier: resolution.specifier,
      candidate:
        resolution.candidateKind === 'outside'
          ? `${OUTSIDE}/${id}/${resolution.candidate}`
          : `${root}/${resolution.candidate}`,
      target: resolution.target ? `${root}/${resolution.target}` : null,
    })),
  };
}

function mod(path, source) {
  return { path, source };
}

function edge(importer, specifier, target) {
  return { importer, specifier, candidate: target, target };
}

function missingEdge(importer, specifier, candidate) {
  return { importer, specifier, candidate, target: null };
}

function outsideEdge(importer, specifier, candidate) {
  return { importer, specifier, candidateKind: 'outside', candidate, target: null };
}

const validMain = `use path="./lib.kern"
  from name=helper kind=fn as=helper
  from name=Thing kind=class as=Thing

fn name=main returns=void
  handler lang="kern"
`;

const validLib = `class name=Thing export=true
  field name=value

fn name=helper params="input:string" returns=string export=true
  handler lang="kern"
    return value="input"
`;

export const FIXTURES = [
  fixture(
    'valid-multi-file',
    [mod('main.kern', validMain), mod('lib.kern', validLib)],
    [edge('main.kern', './lib.kern', 'lib.kern')],
    { why: 'valid root imports exported function and class from one library module' },
  ),
  fixture(
    'missing-export',
    [
      mod(
        'main.kern',
        `use path="./lib.kern"
  from name=missing kind=fn as=missing

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'lib.kern',
        `fn name=other returns=string export=true
  handler lang="kern"
    return value="\"other\""
`,
      ),
    ],
    [edge('main.kern', './lib.kern', 'lib.kern')],
    { why: 'imported name is absent from the target export graph' },
  ),
  fixture(
    'duplicate-alias',
    [
      mod(
        'main.kern',
        `use path="./lib.kern"
  from name=one kind=fn as=same
  from name=two kind=fn as=same

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'lib.kern',
        `fn name=one returns=string export=true
  handler lang="kern"
    return value="\"one\""

fn name=two returns=string export=true
  handler lang="kern"
    return value="\"two\""
`,
      ),
    ],
    [edge('main.kern', './lib.kern', 'lib.kern')],
    { why: 'two imports claim the same local alias in one importer' },
  ),
  fixture(
    'import-cycle',
    [
      mod(
        'main.kern',
        `use path="./a.kern"
  from name=a kind=fn as=a

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'a.kern',
        `use path="./b.kern"
  from name=b kind=fn as=b

fn name=a returns=string export=true
  handler lang="kern"
    return value="\"a\""
`,
      ),
      mod(
        'b.kern',
        `use path="./a.kern"
  from name=a kind=fn as=a

fn name=b returns=string export=true
  handler lang="kern"
    return value="\"b\""
`,
      ),
    ],
    [
      edge('main.kern', './a.kern', 'a.kern'),
      edge('a.kern', './b.kern', 'b.kern'),
      edge('b.kern', './a.kern', 'a.kern'),
    ],
    { why: 'non-root modules import each other recursively' },
  ),
  fixture(
    'imported-main',
    [
      mod(
        'main.kern',
        `use path="./bad.kern"
  from name=helper kind=fn as=helper

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'bad.kern',
        `fn name=main returns=void
  handler lang="kern"

fn name=helper returns=string export=true
  handler lang="kern"
    return value="\"bad\""
`,
      ),
    ],
    [edge('main.kern', './bad.kern', 'bad.kern')],
    { why: 'imported module declares a native-runner entrypoint' },
  ),
  fixture(
    'kind-mismatch',
    [
      mod(
        'main.kern',
        `use path="./lib.kern"
  from name=Thing kind=fn as=Thing

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'lib.kern',
        `class name=Thing export=true
  field name=value
`,
      ),
    ],
    [edge('main.kern', './lib.kern', 'lib.kern')],
    { why: 'import expects a function but the target exports a class' },
  ),
  fixture(
    'unsupported-exported-fn',
    [
      mod(
        'main.kern',
        `use path="./lib.kern"
  from name=helper kind=fn as=helper

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'lib.kern',
        `fn name=helper returns=void export=true
  handler lang="kern"
`,
      ),
    ],
    [edge('main.kern', './lib.kern', 'lib.kern')],
    { why: 'export=true fn must still be bindable by the native runner before it can satisfy imports' },
  ),
  fixture(
    're-export-success',
    [
      mod(
        'main.kern',
        `use path="./barrel.kern"
  from name=helper kind=fn as=helper

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'barrel.kern',
        `use path="./leaf.kern"
  from name=helper kind=fn as=helper export=true
`,
      ),
      mod(
        'leaf.kern',
        `fn name=helper returns=string export=true
  handler lang="kern"
    return value="\"leaf\""
`,
      ),
    ],
    [edge('main.kern', './barrel.kern', 'barrel.kern'), edge('barrel.kern', './leaf.kern', 'leaf.kern')],
    { why: 'transitive export=true re-export resolves to the leaf export' },
  ),
  fixture(
    'duplicate-re-export',
    [
      mod(
        'main.kern',
        `use path="./barrel.kern"
  from name=helper kind=fn as=helper

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'barrel.kern',
        `use path="./one.kern"
  from name=helper kind=fn as=helper export=true
use path="./two.kern"
  from name=helper kind=fn as=helper export=true
`,
      ),
      mod(
        'one.kern',
        `fn name=helper returns=string export=true
  handler lang="kern"
    return value="\"one\""
`,
      ),
      mod(
        'two.kern',
        `fn name=helper returns=string export=true
  handler lang="kern"
    return value="\"two\""
`,
      ),
    ],
    [
      edge('main.kern', './barrel.kern', 'barrel.kern'),
      edge('barrel.kern', './one.kern', 'one.kern'),
      edge('barrel.kern', './two.kern', 'two.kern'),
    ],
    { why: 'two exported imports produce the same exported name' },
  ),
  fixture(
    'alias-own-conflict',
    [
      mod(
        'main.kern',
        `use path="./lib.kern"
  from name=helper kind=fn as=helper

fn name=helper returns=string
  handler lang="kern"
    return value="\"own\""

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'lib.kern',
        `fn name=helper returns=string export=true
  handler lang="kern"
    return value="\"imported\""
`,
      ),
    ],
    [edge('main.kern', './lib.kern', 'lib.kern')],
    { why: 'imported alias conflicts with an own callable in the importing module' },
  ),
  fixture(
    'duplicate-callables-members-params',
    [
      mod(
        'main.kern',
        `class name=Box
  field name=value
  field name=value
  method name=read
    handler lang="kern"
      return value="1"
  method name=read
    handler lang="kern"
      return value="2"

class name=Box

fn name=helper returns=string
  param name=input
  param name=input
  handler lang="kern"
    return value="input"

fn name=helper returns=string
  handler lang="kern"
    return value="\"dup\""

fn name=main returns=void
  handler lang="kern"
`,
      ),
    ],
    [],
    { why: 'duplicate fn, class, field, member, and parameter rows are all surfaced' },
  ),
  fixture(
    'extends-unknown',
    [
      mod(
        'main.kern',
        `class name=Child extends=Missing

fn name=main returns=void
  handler lang="kern"
`,
      ),
    ],
    [],
    { why: 'class extends a missing class in the same module scope' },
  ),
  fixture(
    'class-cycle',
    [
      mod(
        'main.kern',
        `class name=A extends=B

class name=B extends=A

fn name=main returns=void
  handler lang="kern"
`,
      ),
    ],
    [],
    { why: 'class inheritance cycle is detected without host-computed cycle fields' },
  ),
  fixture(
    'invalid-main-forms',
    [
      mod(
        'main.kern',
        `fn name=main params="input:string" returns=string async=true stream=true
  handler lang="kern"
    return value="input"
`,
      ),
    ],
    [],
    { why: 'root main has params, non-void returns, async, and stream flags' },
  ),
  fixture(
    'broken-imported-module',
    [
      mod(
        'main.kern',
        `use path="./broken.kern"
  from name=helper kind=fn as=helper

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'broken.kern',
        `fn name=helper returns=string export=true
  handler lang="kern"
    return value="unterminated
`,
      ),
    ],
    [edge('main.kern', './broken.kern', 'broken.kern')],
    { why: 'target module source parses with an error diagnostic' },
  ),
  fixture(
    'non-string-source',
    [
      mod(
        'main.kern',
        `use path="./missing-source.kern"
  from name=helper kind=fn as=helper

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod('missing-source.kern', UNREADABLE_SOURCE),
    ],
    [edge('main.kern', './missing-source.kern', 'missing-source.kern')],
    { why: 'loader returns a non-string source for an imported module' },
  ),
  fixture(
    'row-order-shuffled',
    [
      mod(
        'main.kern',
        `use path="./one.kern"
  from name=one kind=fn as=one
use path="./two.kern"
  from name=two kind=fn as=two

fn name=helper returns=string
  handler lang="kern"
    return value="\"helper\""

fn name=main returns=void
  handler lang="kern"
`,
      ),
      mod(
        'one.kern',
        `fn name=one returns=string export=true
  handler lang="kern"
    return value="\"one\""
`,
      ),
      mod(
        'two.kern',
        `fn name=two returns=string export=true
  handler lang="kern"
    return value="\"two\""
`,
      ),
    ],
    [edge('main.kern', './one.kern', 'one.kern'), edge('main.kern', './two.kern', 'two.kern')],
    { why: 'valid fixture with row tables intentionally permuted after flattening', shuffleRows: true },
  ),
  fixture(
    'import-outside-root',
    [
      mod(
        'main.kern',
        `use path="../outside.kern"
  from name=helper kind=fn as=helper

fn name=main returns=void
  handler lang="kern"
`,
      ),
    ],
    [outsideEdge('main.kern', '../outside.kern', 'outside.kern')],
    { why: 'candidate realpath is outside the root realpath' },
  ),
  fixture(
    'symlink-escape',
    [
      mod(
        'main.kern',
        `use path="./link/secret.kern"
  from name=helper kind=fn as=helper

fn name=main returns=void
  handler lang="kern"
`,
      ),
    ],
    [outsideEdge('main.kern', './link/secret.kern', 'secret.kern')],
    { why: 'specifier lexically under root resolves through a symlink to an outside realpath' },
  ),
  fixture(
    'multi-violation-ordering',
    [
      mod(
        'main.kern',
        `use path="./lib.kern"
  from name=missing kind=fn as=dup
  from name=alsoMissing kind=class as=dup

class name=A extends=B

class name=B extends=A

fn name=main returns=string
  handler lang="kern"
    return value="\"bad\""
`,
      ),
      mod(
        'lib.kern',
        `fn name=other returns=string export=true
  handler lang="kern"
    return value="\"other\""
`,
      ),
    ],
    [edge('main.kern', './lib.kern', 'lib.kern')],
    { why: 'multiple independent failures pin collect-all sorting and line stability' },
  ),
];
