/**
 * Source-level oracle fixtures for the KIR-backed Review preview.
 *
 * These are intentionally small, named module sets.  The expected values are
 * semantic contracts for the sibling implementation lanes; they do not
 * encode parser output or source positions.
 */

const userModule = `fn name=fetchUser returns=string export=true
  param name=id type=string
  handler lang="kern"
    capability namespace=db operation=read name=user
    return value="user"
`;

const userModuleRenamed = `fn name=fetchAccount returns=string export=true
  param name=id type=string
  handler lang="kern"
    capability namespace=db operation=read name=user
    return value="user"
`;

const modelsModule = `fn name=getUser returns=string export=true
  param name=id type=string
  handler lang="kern"
    return value="id"
`;

const formattingBase = `# formatting oracle
fn name=main returns=number export=true
  param name=value type=number
  handler lang="kern"
    return value="value + 1"
`;

const formattingHead = `
# The comment and all whitespace are intentionally different.

fn   name=main   returns=number   export=true

  param   name=value   type=number

  handler   lang="kern"
    return   value="value + 1"
`;

const fixtureCases = [
  {
    id: 'module-added-removed',
    facets: ['modules'],
    base: [{ moduleId: 'api/users.kern', source: userModule }],
    head: [
      { moduleId: 'api/users.kern', source: userModule },
      { moduleId: 'api/audit.kern', source: 'fn name=recordAudit export=true\n' },
    ],
    expected: { change: 'added', key: 'api/audit.kern' },
  },
  {
    id: 'public-api-signature',
    facets: ['public-api'],
    base: [{ moduleId: 'api/users.kern', source: userModule }],
    head: [{
      moduleId: 'api/users.kern',
      source: userModule.replace('returns=string', 'returns=number'),
    }],
    expected: { change: 'signature-changed', key: 'api/users.kern/fn/fetchUser' },
  },
  {
    id: 'public-api-rename',
    facets: ['public-api'],
    base: [{ moduleId: 'api/users.kern', source: userModule }],
    head: [{ moduleId: 'api/users.kern', source: userModuleRenamed }],
    expected: { change: 'removed-added-or-rename', before: 'fetchUser', after: 'fetchAccount' },
  },
  {
    id: 'imports',
    facets: ['imports'],
    base: [
      { moduleId: 'api/users.kern', source: 'use path="./models"\n  from name=getUser kind=fn as=getUser\n\nfn name=fetchUser export=true\n' },
      { moduleId: 'api/models.kern', source: modelsModule },
    ],
    head: [
      { moduleId: 'api/users.kern', source: 'use path="./accounts"\n  from name=getUser kind=fn as=getUser\n\nfn name=fetchUser export=true\n' },
      { moduleId: 'api/accounts.kern', source: modelsModule },
    ],
    expected: { change: 'import-source-changed', before: './models', after: './accounts' },
  },
  {
    id: 'dependencies',
    facets: ['dependencies'],
    base: [
      { moduleId: 'api/users.kern', source: 'use path="./models"\n  from name=getUser kind=fn as=getUser\n\nfn name=fetchUser export=true\n' },
      { moduleId: 'api/models.kern', source: modelsModule },
    ],
    head: [
      { moduleId: 'api/users.kern', source: 'use path="./accounts"\n  from name=getUser kind=fn as=getUser\n\nfn name=fetchUser export=true\n' },
      { moduleId: 'api/accounts.kern', source: modelsModule },
    ],
    expected: { change: 'dependency-edge-changed', before: 'models.kern', after: 'accounts.kern' },
  },
  {
    id: 'capability-operation',
    facets: ['capabilities'],
    base: [{ moduleId: 'runtime.kern', source: userModule }],
    head: [{ moduleId: 'runtime.kern', source: userModule.replace('operation=read', 'operation=write') }],
    expected: { change: 'capability-changed', before: 'db/read', after: 'db/write' },
  },
  {
    id: 'call-target-and-arguments',
    facets: ['calls'],
    base: [{
      moduleId: 'calls.kern',
      source: 'fn name=main export=true\n  handler lang="kern"\n    return value="fetchUser(\"a\")"\n',
    }],
    head: [{
      moduleId: 'calls.kern',
      source: 'fn name=main export=true\n  handler lang="kern"\n    return value="fetchAccount(\"b\")"\n',
    }],
    expected: { change: 'call-target-or-argument-shape-changed', before: 'fetchUser("a")', after: 'fetchAccount("b")' },
  },
  {
    id: 'effects',
    facets: ['effects'],
    base: [{
      moduleId: 'effects.kern',
      source: 'fn name=main export=true\n  handler lang="kern"\n    throw value="new Error(\\"readUsers\\")"\n',
    }],
    head: [{
      moduleId: 'effects.kern',
      source: 'fn name=main export=true\n  handler lang="kern"\n    throw value="new Error(\\"writeUsers\\")"\n',
    }],
    expected: { change: 'effect-changed', before: 'readUsers', after: 'writeUsers' },
  },
  {
    id: 'structure-property',
    facets: ['structure'],
    base: [{
      moduleId: 'structure.kern',
      source: 'class name=Dashboard export=true\n  field name=route value="7"\n',
    }],
    head: [{
      moduleId: 'structure.kern',
      source: 'class name=Dashboard export=true\n  field name=route value="8"\n',
    }],
    expected: { change: 'structural-property-changed', key: 'class/Dashboard/route' },
  },
  {
    id: 'target-compatibility',
    facets: ['target-compatibility'],
    base: [{
      moduleId: 'target.kern',
      source: 'fn name=main returns=void export=true\n  handler lang="kern"\n    return value="0"\n',
    }],
    head: [{
      moduleId: 'target.kern',
      source: 'fn name=main returns=void export=true\n  handler lang="kern"\n    capability namespace=browser operation=clipboardWrite name=write\n',
    }],
    expected: { change: 'target-profile-incompatibility', key: 'browser/clipboardWrite' },
    invocation: { targetProfile: 'kern.review.target.default.v1' },
  },
  {
    id: 'formatting-only',
    facets: ['formatting'],
    base: [{ moduleId: 'formatting.kern', source: formattingBase }],
    head: [{ moduleId: 'formatting.kern', source: formattingHead }],
    expected: { change: 'none', findings: 0, equalSemantics: true },
  },
  {
    id: 'projection-rejection-malformed',
    facets: ['projection-rejection', 'atomicity'],
    base: [{ moduleId: 'broken.kern', source: 'fn name=broken export=true\n  handler lang="kern"\n    return value="unterminated\n' }],
    head: [{ moduleId: 'broken.kern', source: 'fn name=broken export=true\n  handler lang="kern"\n    return value="unterminated\n' }],
    expected: { status: 'failed', diagnosticCode: 'F4_F1_DRIFT', bytes: null, findings: 0 },
    invocation: { mode: 'canonical-kir-preview' },
  },
  {
    id: 'dual-failure-no-fallback',
    facets: ['dual-compare', 'projection-rejection'],
    // Duplicate module IDs are rejected atomically by projection.  A legacy
    // caller can still analyze the individual source, making fallback bugs
    // observable without relying on malformed source text.
    base: [
      { moduleId: 'duplicate.kern', source: 'fn name=main export=true\n' },
      { moduleId: 'duplicate.kern', source: 'fn name=other export=true\n' },
    ],
    head: [{ moduleId: 'duplicate.kern', source: 'fn name=main export=true\n' }],
    expected: {
      canonical: { status: 'failed', findings: 0 },
      legacy: { status: 'complete' },
      overall: 'failed',
      fallback: false,
    },
    invocation: { mode: 'dual-compare', expectLegacySuccess: true },
  },
];

const byId = new Map(fixtureCases.map((fixture) => [fixture.id, fixture]));

function pair(id) {
  const fixture = byId.get(id);
  return { base: { modules: fixture.base }, head: { modules: fixture.head }, expected: fixture.expected };
}

const facetMutations = {
  modules: pair('module-added-removed'),
  publicApi: pair('public-api-signature'),
  imports: pair('imports'),
  dependencies: pair('dependencies'),
  capabilities: pair('capability-operation'),
  calls: pair('call-target-and-arguments'),
  effects: pair('effects'),
  structure: pair('structure-property'),
  targetCompatibility: pair('target-compatibility'),
};

const base = {
  modules: byId.get('module-added-removed').base,
};

const formattingOnly = pair('formatting-only');
const reordered = {
  base: { modules: [
    { moduleId: 'z.kern', source: 'fn name=z export=true\n' },
    { moduleId: 'a.kern', source: 'fn name=a export=true\n' },
  ] },
  head: { modules: [
    { moduleId: 'a.kern', source: 'fn name=a export=true\n' },
    { moduleId: 'z.kern', source: 'fn name=z export=true\n' },
  ] },
  expected: { change: 'none', findings: 0, equalSemantics: true },
};

const projectionFailure = {
  modules: byId.get('projection-rejection-malformed').base,
  duplicateModules: byId.get('dual-failure-no-fallback').base,
  expected: byId.get('projection-rejection-malformed').expected,
};

const KIR_REVIEW_FIXTURES = {
  base,
  facetMutations,
  formattingOnly,
  reordered,
  projectionFailure,
  cli: { source: byId.get('formatting-only').base[0].source },
  cases: fixtureCases,
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export { KIR_REVIEW_FIXTURES };
