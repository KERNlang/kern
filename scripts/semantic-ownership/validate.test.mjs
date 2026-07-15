import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateSemanticOwnership } from './validate.mjs';

const policy = JSON.parse(readFileSync('scripts/semantic-ownership/policy.json', 'utf8'));

function mutate(change, options) {
  const copy = structuredClone(policy);
  change(copy);
  return () => validateSemanticOwnership(copy, options);
}

const SYNC_RUNTIME_WITNESS = `    trace = executeSourceRunnerSync(handler.children ?? [], env, {
      policy: 'compatible',
      iterationBudget: options.iterationBudget,
    });`;

function replaceSyncRuntimeWitness(source, replacement) {
  const firstIndex = source.indexOf(SYNC_RUNTIME_WITNESS);
  assert.notEqual(firstIndex, -1, 'sync runtime witness fixture must match runner source');
  assert.equal(
    source.indexOf(SYNC_RUNTIME_WITNESS, firstIndex + SYNC_RUNTIME_WITNESS.length),
    -1,
    'sync runtime witness fixture must be unique',
  );
  return source.replace(SYNC_RUNTIME_WITNESS, replacement);
}

test('repository ownership policy is a bootstrap-dependent proof', () => {
  assert.equal(validateSemanticOwnership(structuredClone(policy)).proofLabel, 'BOOTSTRAP-DEPENDENT');
});

const graphMutations = [
  ['self-cycle', (copy) => copy.canonicalEdges.push({ from: 'kern-interpreter', to: 'kern-interpreter' }), /cycle/u],
  ['reverse edge', (copy) => copy.canonicalEdges.push({ from: 'kern-interpreter', to: 'kir-reader-candidate' }), /cycle/u],
  ['disconnected owner', (copy) => copy.canonicalEdges.splice(1, 1), /disconnected|unreachable/u],
  ['oracle reachability', (copy) => copy.canonicalEdges.push({ from: 'kern-interpreter', to: 'reference-runner' }), /forbidden/u],
  ['dangling edge', (copy) => copy.canonicalEdges.push({ from: 'kern-interpreter', to: 'missing-runtime' }), /dangling/u],
];

for (const [name, change, error] of graphMutations) {
  test(`rejects ${name}`, () => assert.throws(mutate(change), error));
}

test('reader candidate cannot be promoted to semantic owner', () => {
  assert.throws(
    mutate((copy) => {
      copy.contracts.find((contract) => contract.id === 'semantic-execution').owner = 'kir-reader-candidate';
    }),
    /planned-semantic-owner/u,
  );
});

test('contract ownership cannot be duplicated', () => {
  assert.throws(
    mutate((copy) => copy.contracts.push(structuredClone(copy.contracts[0]))),
    /duplicate id/u,
  );
});

test('current authority witness cannot drift', () => {
  assert.throws(
    mutate((copy) => {
      copy.currentWitnesses[0].evidence = 'returned-imported-call:invented:invented:./missing.js:missing';
    }),
    /source evidence drifted|definition changed/u,
  );
});

test('comments cannot spoof a current authority witness', () => {
  const runner = readFileSync('packages/core/src/runner.ts', 'utf8');
  const withoutSyncCall = replaceSyncRuntimeWitness(
    runner,
    "    trace = emptyTrace(); // executeSourceRunnerSync(handler.children ?? [], env, { policy: 'compatible' })",
  );
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return sourcePath === 'packages/core/src/runner.ts' ? withoutSyncCall : readFileSync(sourcePath, 'utf8');
      },
    }),
    /sync-runtime-to-source-selector source evidence drifted/u,
  );
});

test('dead same-named call outside runtime function cannot spoof authority witness', () => {
  const runner = replaceSyncRuntimeWitness(
    readFileSync('packages/core/src/runner.ts', 'utf8'),
    '    trace = emptyTrace();',
  )
    .concat("\nfunction deadWitnessProbe(env){ return executeSourceRunnerSync([], env, { policy: 'compatible' }); }\n");
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return sourcePath === 'packages/core/src/runner.ts' ? runner : readFileSync(sourcePath, 'utf8');
      },
    }),
    /sync-runtime-to-source-selector source evidence drifted/u,
  );
});

test('local same-name function cannot spoof an imported authority witness', () => {
  const runner = readFileSync('packages/core/src/runner.ts', 'utf8')
    .replace(/\s*executeSourceRunnerSync,\n/u, '\n')
    .replace(
      "trace = executeSourceRunnerSync(handler.children ?? [], env, { policy: 'compatible' });",
      "trace = localSourceRunnerSync(handler.children ?? [], env, { policy: 'compatible' });",
    )
    .concat('\nfunction executeSourceRunnerSync(){ return undefined; }\n');
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return sourcePath === 'packages/core/src/runner.ts' ? runner : readFileSync(sourcePath, 'utf8');
      },
    }),
    /sync-runtime-to-source-selector source evidence drifted/u,
  );
});

test('nested local shadow cannot spoof an imported authority witness', () => {
  const runner = replaceSyncRuntimeWitness(
    readFileSync('packages/core/src/runner.ts', 'utf8'),
    '    trace = (() => { const executeSourceRunnerSync = emptyTrace; return executeSourceRunnerSync(); })();',
  );
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return sourcePath === 'packages/core/src/runner.ts' ? runner : readFileSync(sourcePath, 'utf8');
      },
    }),
    /sync-runtime-to-source-selector source evidence drifted/u,
  );
});

test('short call-array witness fails closed without throwing TypeError', () => {
  const checker = readFileSync('scripts/check-capstone-checker-subset.mjs', 'utf8').replace(
    "spawnSync(process.execPath, [CLI, 'run', MAIN_KERN], {",
    'spawnSync(); // removed authority edge\nvoid ({',
  );
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return sourcePath === 'scripts/check-capstone-checker-subset.mjs' ? checker : readFileSync(sourcePath, 'utf8');
      },
    }),
    /checker-to-cli source evidence drifted/u,
  );
});

test('CLI authority witness requires the Node executable', () => {
  const checker = readFileSync('scripts/check-capstone-checker-subset.mjs', 'utf8').replace(
    "spawnSync(process.execPath, [CLI, 'run', MAIN_KERN], {",
    "spawnSync('/bin/echo', [CLI, 'run', MAIN_KERN], {",
  );
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return sourcePath === 'scripts/check-capstone-checker-subset.mjs' ? checker : readFileSync(sourcePath, 'utf8');
      },
    }),
    /checker-to-cli source evidence drifted/u,
  );
});

test('current authority witness cannot be omitted', () => {
  assert.throws(mutate((copy) => { copy.currentWitnesses.pop(); }), /witness ids/u);
});

test('oracle cannot be relabeled as a planned owner', () => {
  assert.throws(
    mutate((copy) => {
      copy.components.find((component) => component.id === 'reference-runner').role = 'planned-owner';
    }),
    /disconnected|classification changed/u,
  );
});

test('forbidden oracle role cannot be removed', () => {
  assert.throws(
    mutate((copy) => {
      copy.forbiddenCanonicalRoles = copy.forbiddenCanonicalRoles.filter((role) => role !== 'differential-oracle');
    }),
    /disconnected|forbiddenCanonicalRoles/u,
  );
});

test('canonical path cannot gain a shortcut', () => {
  assert.throws(
    mutate((copy) => copy.canonicalEdges.push({ from: 'source-input', to: 'kern-interpreter' })),
    /canonical edges/u,
  );
});

test('reader containment paths cannot be weakened', () => {
  assert.throws(
    mutate((copy) => { copy.readerContainment.absentFrom = ['packages/core/package.json']; }),
    /reader containment paths/u,
  );
});

test('reader containment paths reject duplicate-for-omission substitution', () => {
  assert.throws(
    mutate((copy) => {
      copy.readerContainment.absentFrom = [
        'packages/core/package.json',
        'packages/core/src/index.ts',
        'packages/core/src/runner.ts',
        'packages/core/src/runner.ts',
      ];
    }),
    /reader containment paths/u,
  );
  assert.throws(
    mutate((copy) => {
      copy.readerContainment.entrypoints = [
        'packages/core/src/index.ts',
        'packages/core/src/runner.ts',
        'packages/core/src/runner.ts',
      ];
    }),
    /reader containment entrypoints/u,
  );
});

test('reader source and probe format are positively bound', () => {
  assert.throws(
    mutate((copy) => { copy.readerBinding.includes = "export const KIR_READER_CANDIDATE_FORMAT = 'kern.semantic-kir.v1' as const;"; }),
    /reader binding source evidence drifted|reader binding changed/u,
  );
});

test('indirect runtime reader adoption breaks transitive containment', () => {
  const overlay = new Map([
    [
      'packages/core/src/runner.ts',
      `${readFileSync('packages/core/src/runner.ts', 'utf8')}\nimport './semantic-owner-adapter.js';\n`,
    ],
    [
      'packages/core/src/semantic-owner-adapter.ts',
      "export { encodeKirReaderCandidate } from './kir-reader-candidate/canonical.js';\n",
    ],
  ]);
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return overlay.get(sourcePath) ?? readFileSync(sourcePath, 'utf8');
      },
    }),
    /reader candidate is reachable/u,
  );
});

test('core self-import adapter cannot hide reader adoption', () => {
  const packageJson = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
  packageJson.exports['./semantic-owner-adapter'] = {
    types: './dist/semantic-owner-adapter.d.ts',
    default: './dist/semantic-owner-adapter.js',
  };
  const overlay = new Map([
    ['packages/core/package.json', JSON.stringify(packageJson)],
    [
      'packages/core/src/runner.ts',
      `${readFileSync('packages/core/src/runner.ts', 'utf8')}\nimport '@kernlang/core/semantic-owner-adapter';\n`,
    ],
    [
      'packages/core/src/semantic-owner-adapter.ts',
      "export { encodeKirReaderCandidate } from './kir-reader-candidate/canonical.js';\n",
    ],
  ]);
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return overlay.get(sourcePath) ?? readFileSync(sourcePath, 'utf8');
      },
    }),
    /reader candidate is reachable/u,
  );
});

test('new public export adapter cannot hide reader adoption', () => {
  const packageJson = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
  packageJson.exports['./semantic-owner-adapter'] = {
    types: './dist/semantic-owner-adapter.d.ts',
    default: './dist/semantic-owner-adapter.js',
  };
  const overlay = new Map([
    ['packages/core/package.json', JSON.stringify(packageJson)],
    [
      'packages/core/src/semantic-owner-adapter.ts',
      "export { encodeKirReaderCandidate } from './kir-reader-candidate/canonical.js';\n",
    ],
  ]);
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return overlay.get(sourcePath) ?? readFileSync(sourcePath, 'utf8');
      },
    }),
    /reader candidate is reachable/u,
  );
});

test('repo-local adapter outside core source cannot hide reader adoption', () => {
  const overlay = new Map([
    [
      'packages/core/src/runner.ts',
      `${readFileSync('packages/core/src/runner.ts', 'utf8')}\nimport '../../../scripts/semantic-owner-adapter.mjs';\n`,
    ],
    [
      'scripts/semantic-owner-adapter.mjs',
      "export { encodeKirReaderCandidate } from '../packages/core/src/kir-reader-candidate/canonical.js';\n",
    ],
  ]);
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return overlay.get(sourcePath) ?? readFileSync(sourcePath, 'utf8');
      },
    }),
    /reader candidate is reachable/u,
  );
});

for (const [name, adapterSource] of [
  ['compact import', "import{encodeKirReaderCandidate}from'./kir-reader-candidate/canonical.js';\n"],
  ['compact export', "export{encodeKirReaderCandidate}from'./kir-reader-candidate/canonical.js';\n"],
  ['second same-line import', "import './types.js'; import './kir-reader-candidate/canonical.js';\n"],
  ['literal dynamic import', "export async function load(){return import('./kir-reader-candidate/canonical.js');}\n"],
  ['literal CommonJS require', "export const reader=require('./kir-reader-candidate/canonical.js');\n"],
]) {
  test(`${name} cannot bypass transitive reader containment`, () => {
    const overlay = new Map([
      [
        'packages/core/src/runner.ts',
        `${readFileSync('packages/core/src/runner.ts', 'utf8')}\nimport './semantic-owner-adapter.js';\n`,
      ],
      ['packages/core/src/semantic-owner-adapter.ts', adapterSource],
    ]);
    assert.throws(
      () => validateSemanticOwnership(structuredClone(policy), {
        readText(sourcePath) {
          return overlay.get(sourcePath) ?? readFileSync(sourcePath, 'utf8');
        },
      }),
      /reader candidate is reachable/u,
    );
  });
}

test('non-literal dynamic import in runtime graph fails closed', () => {
  const overlay = new Map([
    [
      'packages/core/src/runner.ts',
      `${readFileSync('packages/core/src/runner.ts', 'utf8')}\nimport './semantic-owner-adapter.js';\n`,
    ],
    ['packages/core/src/semantic-owner-adapter.ts', 'export async function load(path){return import(path);}\n'],
  ]);
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return overlay.get(sourcePath) ?? readFileSync(sourcePath, 'utf8');
      },
    }),
    /non-literal dynamic import/u,
  );
});

test('non-literal CommonJS require in runtime graph fails closed', () => {
  const overlay = new Map([
    [
      'packages/core/src/runner.ts',
      `${readFileSync('packages/core/src/runner.ts', 'utf8')}\nimport './semantic-owner-adapter.js';\n`,
    ],
    ['packages/core/src/semantic-owner-adapter.ts', 'export function load(path){return require(path);}\n'],
  ]);
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return overlay.get(sourcePath) ?? readFileSync(sourcePath, 'utf8');
      },
    }),
    /non-literal require/u,
  );
});

test('malformed runtime module graph source fails closed', () => {
  const overlay = new Map([
    [
      'packages/core/src/runner.ts',
      `${readFileSync('packages/core/src/runner.ts', 'utf8')}\nimport './semantic-owner-adapter.js';\n`,
    ],
    ['packages/core/src/semantic-owner-adapter.ts', "import { broken from './kir-reader-candidate/canonical.js';\n"],
  ]);
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return overlay.get(sourcePath) ?? readFileSync(sourcePath, 'utf8');
      },
    }),
    /cannot parse module graph source/u,
  );
});

for (const claim of ['runtimeCutover', 'kirV1Frozen', 'publicReaderExport', 'semanticSelfHosting']) {
  test(`cannot claim ${claim}`, () => {
    assert.throws(mutate((copy) => { copy.claims[claim] = true; }), new RegExp(claim, 'u'));
  });
}

test('proof cannot hide bootstrap dependency', () => {
  assert.throws(mutate((copy) => { copy.proofLabel = 'SEMANTICALLY-INDEPENDENT'; }), /BOOTSTRAP-DEPENDENT/u);
});

test('runtime or public reader adoption breaks containment', () => {
  const overlay = new Map([
    ['packages/core/src/runner.ts', `${readFileSync('packages/core/src/runner.ts', 'utf8')}\nkir-reader-candidate`],
  ]);
  assert.throws(
    () => validateSemanticOwnership(structuredClone(policy), {
      readText(sourcePath) {
        return overlay.get(sourcePath) ?? readFileSync(sourcePath, 'utf8');
      },
    }),
    /escaped containment/u,
  );
});
