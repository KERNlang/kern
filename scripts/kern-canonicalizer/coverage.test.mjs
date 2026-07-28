import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { loadCanonicalizerPolicy } from './policy.mjs';
import {
  assertCoverageClosed,
  collectCanonicalExpressionKinds,
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  readCorpusMemberBytes,
  summarizeCanonicalizerCoverage,
  validateCoveragePolicy,
} from './coverage.mjs';
import {
  baseExpressionProfileBlockers,
  canonicalProfileRowsForFunction,
  profileBlockersForFunction,
} from './coverage-profile.mjs';
import {
  CANONICALIZER_COMPOSITE_PATH,
  CANONICALIZER_COMPOSITION_MEMBERS,
  canonicalCompositionRecordBytes,
  verifyCanonicalizerComposition,
} from './composition.mjs';
import { assertStructuredParameterMigrations } from './coverage-parameter-migrations.mjs';
import { assertM441ParameterMigrations } from './coverage-m4-41-parameter-migrations.mjs';
import { assertM445ParameterMigrations } from './coverage-m4-45-parameter-migrations.mjs';
import { assertM449ParameterMigrations } from './coverage-m4-49-parameter-migrations.mjs';
import { assertM453ParameterMigration } from './coverage-m4-53-parameter-migration.mjs';
import { assertM457ParameterMigrations } from './coverage-m4-57-parameter-migrations.mjs';
import { assertM461ParameterMigration } from './coverage-m4-61-parameter-migration.mjs';
import { assertM465ParameterMigrations } from './coverage-m4-65-parameter-migrations.mjs';
import { assertM469ParameterMigration } from './coverage-m4-69-parameter-migration.mjs';
import { assertM473ParameterMigration } from './coverage-m4-73-parameter-migration.mjs';
import { assertM477ParameterMigration } from './coverage-m4-77-parameter-migration.mjs';
import { assertM482ParameterMigration } from './coverage-m4-82-parameter-migration.mjs';
import { assertM491ParameterMigrations } from './coverage-m4-91-parameter-migrations.mjs';
import { assertValueBandParameterMigrations } from './coverage-value-band-parameter-migrations.mjs';
import { VALID_FIXTURES } from './fixtures.mjs';

function canonicalExpression(kind, fields) {
  return {
    tag: 'record',
    value: [
      {
        key: 'fields',
        value: {
          tag: 'record',
          value: Object.entries(fields).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([key, value]) => ({ key, value })),
        },
      },
      { key: 'kind', value: { tag: 'text', value: kind } },
    ],
  };
}

test('the handwritten corpus produces one deterministic catalog-bound selection receipt', () => {
  const policy = loadCoveragePolicy();
  const first = measureCanonicalizerCoverage(policy);
  const second = measureCanonicalizerCoverage(policy);
  assert.deepEqual(second, first);
  assert.equal(first.format, 'kern.kir-canonicalizer.coverage-receipt.6');
  const composition = verifyCanonicalizerComposition();
  assert.deepEqual(first.composition.record, composition.record);
  assert.equal(
    first.composition.digest,
    createHash('sha256').update(canonicalCompositionRecordBytes(composition.record)).digest('hex'),
  );
  assert.equal(first.canonicalizerDigest, composition.record.composite.sha256);
  assert.equal(
    first.selectionProvenances[0].digest,
    '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027',
  );
  assert.deepEqual(first.selectionProvenances[0].record.snapshot, {
    corpusMembers: 7,
    functionCount: 98,
    selection: {
      completeFunctions: 3,
      completeTools: 1,
      id: 'binary-expression',
      occurrences: 941,
      witnesses: [
        'examples/capstone-assertion-engine/diag.kern#4:reasonTypeMismatch',
        'examples/capstone-assertion-engine/diag.kern#5:reasonValueMismatch',
        'examples/capstone-assertion-engine/diag.kern#7:reasonKeyMismatch',
      ],
    },
    toolCount: 4,
  });
  assert.equal(
    first.selectionProvenances[1].digest,
    'fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b',
  );
  assert.deepEqual(first.selectionProvenances[1].record.snapshot, {
    corpusMembers: 8,
    functionCount: 99,
    selection: {
      completeFunctions: 2,
      completeTools: 1,
      id: 'conditional',
      occurrences: 1115,
      witnesses: [
        'examples/capstone-assertion-engine/diag.kern#0:pathAppendKey',
        'examples/capstone-assertion-engine/diag.kern#3:failResult',
      ],
    },
    toolCount: 4,
  });
  assert.equal(
    first.selectionProvenances[2].digest,
    '7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605',
  );
  assert.deepEqual(first.selectionProvenances[2].record.snapshot, {
    corpusMembers: 9,
    functionCount: 104,
    selection: {
      completeFunctions: 2,
      completeTools: 1,
      id: 'call-expression',
      occurrences: 481,
      witnesses: [
        'examples/capstone-assertion-engine/diag.kern#1:pathAppendIndex',
        'examples/capstone-assertion-engine/diag.kern#6:reasonLengthMismatch',
      ],
    },
    toolCount: 4,
  });
  assert.equal(
    first.selectionProvenances[3].digest,
    '83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d',
  );
  assert.equal(first.implementationSelectionProvenanceDigest, first.selectionProvenances[3].digest);
  assert.deepEqual(first.selectionProvenances[3].record.snapshot, {
    corpusMembers: 9,
    functionCount: 104,
    selection: {
      completeFunctions: 1,
      completeTools: 1,
      id: 'member-expression',
      occurrences: 259,
      witnesses: [
        'examples/capstone-checker-subset/checker-while.kern#8:isPositiveSafeIntText',
      ],
    },
    toolCount: 4,
  });
  assert.deepEqual(first.implementationProvenance, {
    family: 'while-iteration',
    provenanceDigest: '5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07',
    provenanceKind: 'prerequisite',
  });
  assert.deepEqual(
    first.prerequisiteProvenances.map(({ digest }) => digest),
    [
      '3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869',
      'af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b',
      '00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab',
      'e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5',
      '3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72',
      '5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07',
    ],
  );
  assert.equal(
    first.canonicalizerPolicyDigest,
    createHash('sha256').update(readFileSync(new URL('./policy.json', import.meta.url))).digest('hex'),
  );
  assert.match(first.coveragePolicyDigest, /^[0-9a-f]{64}$/u);
  assert.match(first.corpusDigest, /^[0-9a-f]{64}$/u);
  assert.equal(first.corpus.length, policy.corpus.length);
  assert.equal(first.corpus.length, 9);
  assert.equal(first.functions.length, 111);
  assert.deepEqual(
    first.corpus.filter(({ path }) => CANONICALIZER_COMPOSITION_MEMBERS.includes(path)).map(({ path }) => path),
    CANONICALIZER_COMPOSITION_MEMBERS,
  );
  assert.equal(first.corpus.some(({ path }) => path === CANONICALIZER_COMPOSITE_PATH), false);
  assert.equal(new Set(first.corpus.map(({ tool }) => tool)).size, 4);
  assert.deepEqual(new Set(first.corpus.map(({ sourceKind }) => sourceKind)), new Set(['handwritten']));
  assert.ok(first.functions.length > 0);
  assert.ok(first.functions.some(({ firstUnsupported }) => firstUnsupported !== null));
  const diagFunctions = first.functions.filter(({ id }) => id.startsWith('examples/capstone-assertion-engine/diag.kern#'));
  assert.deepEqual(diagFunctions.map(({ id }) => id), [
    'examples/capstone-assertion-engine/diag.kern#0:pathAppendKey',
    'examples/capstone-assertion-engine/diag.kern#1:pathAppendIndex',
    'examples/capstone-assertion-engine/diag.kern#2:passResult',
    'examples/capstone-assertion-engine/diag.kern#3:failResult',
    'examples/capstone-assertion-engine/diag.kern#4:reasonTypeMismatch',
    'examples/capstone-assertion-engine/diag.kern#5:reasonValueMismatch',
    'examples/capstone-assertion-engine/diag.kern#6:reasonLengthMismatch',
    'examples/capstone-assertion-engine/diag.kern#7:reasonKeyMismatch',
  ]);
  assert.equal(diagFunctions.every(({ excludedProperties }) => !excludedProperties.includes('fn.params')), true);
  assert.equal(
    diagFunctions.flatMap(({ nodeOccurrences }) => nodeOccurrences).filter((kind) => kind === 'param').length,
    14,
  );
  assertStructuredParameterMigrations(first);
  assertValueBandParameterMigrations(first);
  assertM441ParameterMigrations(first);
  assertM445ParameterMigrations(first);
  assertM449ParameterMigrations(first);
  assertM453ParameterMigration(first);
  assertM457ParameterMigrations(first);
  assertM461ParameterMigration(first);
  assertM465ParameterMigrations(first);
  assertM469ParameterMigration(first);
  assertM473ParameterMigration(first);
  assertM477ParameterMigration(first);
  assertM482ParameterMigration(first);
  assertM491ParameterMigrations(first);
  assert.equal(first.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length, 6);
  assert.equal(first.baseCompleteFunctions, 101);
  assert.equal(first.selection.winner, null);
  assert.deepEqual(first.selection.ranking.map(({ completeFunctions }) => completeFunctions), [0]);
  assert.deepEqual(first.selection.ranking.map(({ id }) => id), ['exception-flow']);
  const checkedIn = JSON.parse(readFileSync(new URL('./coverage-summary.json', import.meta.url), 'utf8'));
  assert.deepEqual(summarizeCanonicalizerCoverage(first), checkedIn);
  const fresh = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import {summarizeCanonicalizerCoverage} from './scripts/kern-canonicalizer/coverage.mjs'; process.stdout.write(JSON.stringify(summarizeCanonicalizerCoverage()))",
  ], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.deepEqual(JSON.parse(fresh.stdout), checkedIn);
});

test('policy validation rejects corpus, family, ordering, and catalog invention', () => {
  const policy = loadCoveragePolicy();
  for (const mutate of [
    (copy) => { copy.future = true; },
    (copy) => { copy.corpus[0].future = true; },
    (copy) => { copy.corpus[0].sourceKind = 'generated'; },
    (copy) => { copy.corpus[1].path = copy.corpus[0].path; },
    (copy) => { copy.corpus[0].digest = '0'.repeat(64); },
    (copy) => {
      copy.corpus.push({
        digest: '0'.repeat(64),
        path: 'examples/000-missing.kern', sourceKind: 'handwritten',
        tool: 'missing',
      });
      copy.corpus.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    },
    (copy) => {
      const path = 'examples/capstone-assertion-engine/main.kern';
      copy.corpus.push({
        digest: createHash('sha256').update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest('hex'),
        path, sourceKind: 'handwritten',
        tool: 'assertion-engine',
      });
      copy.corpus.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    },
    (copy) => { copy.corpus.reverse(); },
    (copy) => { copy.families[0].future = true; },
    (copy) => { copy.families.push(structuredClone(copy.families[0])); },
    (copy) => { copy.families[0].nodeKinds = ['not-a-real-kir-kind']; },
    (copy) => { copy.families[0].expressionKinds = ['not-a-real-expression-kind']; },
    (copy) => { copy.families[0].nodeKinds.push('while'); copy.families[0].nodeKinds.sort(); },
    (copy) => { copy.base.expressionKinds.push('decimal'); copy.base.expressionKinds.sort(); },
    (copy) => { copy.base.propertyKeys.pop(); },
  ]) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(() => validateCoveragePolicy(copy), /coverage policy rejection/u);
  }
});

test('coverage policy rejects the generated canonicalizer composite as handwritten evidence', () => {
  const policy = loadCoveragePolicy();
  const copy = structuredClone(policy);
  const main = copy.corpus.findIndex(({ path }) => path === CANONICALIZER_COMPOSITION_MEMBERS[1]);
  copy.corpus[main] = {
    digest: createHash('sha256')
      .update(readFileSync(new URL(`../../${CANONICALIZER_COMPOSITE_PATH}`, import.meta.url)))
      .digest('hex'),
    path: CANONICALIZER_COMPOSITE_PATH,
    sourceKind: 'handwritten',
    tool: 'canonicalizer',
  };
  copy.corpus.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  assert.throws(
    () => validateCoveragePolicy(copy),
    /generated composite cannot enter handwritten corpus/u,
  );
});

test('coverage closure rejects unobserved family facts and invented properties', () => {
  const policy = loadCoveragePolicy();
  const measured = measureCanonicalizerCoverage(policy);
  assert.throws(
    () => assertCoverageClosed(policy, measured.functions.filter(({ nodeKinds }) => !nodeKinds.includes('throw'))),
    /unobserved node kind throw/u,
  );
  const inventedProperty = structuredClone(measured.functions);
  inventedProperty[0].propertyKeys.push('if.future');
  assert.throws(() => assertCoverageClosed(policy, inventedProperty), /unclaimed property if.future/u);
  const inventedBaseProperty = structuredClone(measured.functions);
  inventedBaseProperty[0].propertyKeys.push('fn.future');
  assert.throws(() => assertCoverageClosed(policy, inventedBaseProperty), /unclaimed property fn.future/u);
});

test('coverage closure records catalog-excluded candidate properties as blockers rather than family claims', () => {
  const policy = loadCoveragePolicy();
  const functions = structuredClone(measureCanonicalizerCoverage(policy).functions);
  const target = functions.find(({ nodeKinds }) => nodeKinds.includes('let'));
  assert.ok(target);
  target.propertyKeys.push('let.type');
  target.propertyKeys.sort();
  target.propertyOccurrences.push('let.type');
  target.propertyOccurrences.sort();
  assert.doesNotThrow(() => assertCoverageClosed(policy, functions));
});

test('the exact M4.1 property and child profile blocks catalog-wide false completion', () => {
  const parsed = parseDocumentWithDiagnostics([
    'fn name=profileGap returns=string async=true',
    '  handler lang=kern',
    '    return value="\\"one\\""',
    '    return value="\\"two\\""',
  ].join('\n'));
  const root = parsed.root.children[0];
  assert.deepEqual(profileBlockersForFunction(root, loadCoveragePolicy().base), [
    'fn.properties.async',
    'handler.children',
  ]);
});

test('nested base expressions remain validated under a candidate expression', () => {
  const candidate = canonicalExpression('binary', {
    left: canonicalExpression('identifier', { name: { tag: 'text', value: 'x' } }),
    op: { tag: 'text', value: '+' },
    right: canonicalExpression('identifier', { name: { tag: 'text', value: 'await' } }),
  });
  assert.deepEqual(baseExpressionProfileBlockers(candidate, loadCoveragePolicy().base), [
    'expression.identifier.await',
  ]);
});

test('every expression-shaped record remains visible to catalog closure', () => {
  assert.deepEqual(collectCanonicalExpressionKinds(canonicalExpression('future-expression', {})), [
    'future-expression',
  ]);
});

test('the base text-expression profile enforces the KERN quotesource character ceiling', () => {
  const base = loadCoveragePolicy().base;
  for (const value of ['\0', '\u007f', '\u0080', '\u009f', '\u2028', '\u2029', '\ufeff']) {
    const blockers = baseExpressionProfileBlockers(
      canonicalExpression('text', { value: { tag: 'text', value } }),
      base,
    );
    assert.equal(blockers.length, 1, `must reject U+${value.charCodeAt(0).toString(16).padStart(4, '0')}`);
    assert.match(blockers[0], /^expression\.text\.character-/u);
  }
  for (const value of ['\t', '\n', '\r', 'plain']) {
    assert.deepEqual(
      baseExpressionProfileBlockers(canonicalExpression('text', { value: { tag: 'text', value } }), base),
      [],
    );
  }
});

test('the active profile rejects rows above the M4.107 node, property, and value ceilings', () => {
  const parsed = parseDocumentWithDiagnostics([
    'fn name=tooManyRows returns=void',
    ...Array.from({ length: 14 }, (_, index) => `  param name=p${index} type=number`),
    '  handler lang=kern',
    '    return',
  ].join('\n'));
  const blockers = profileBlockersForFunction(
    parsed.root.children[0],
    loadCoveragePolicy().base,
    loadCanonicalizerPolicy().profileLimits,
    { nodes: 90, properties: 126, values: 2101 },
  );
  assert.deepEqual(blockers, ['profile.rows.nodes', 'profile.rows.properties', 'profile.rows.values']);
});

test('profile node ceilings use the codec-measured row count', () => {
  const parsed = parseDocumentWithDiagnostics([
    'fn name=codecRowsOnly returns=void',
    '  handler lang=kern',
    '    return',
  ].join('\n'));
  const blockers = profileBlockersForFunction(
    parsed.root.children[0],
    loadCoveragePolicy().base,
    loadCanonicalizerPolicy().profileLimits,
    { nodes: 90, properties: 3, values: 4 },
  );
  assert.ok(blockers.includes('profile.rows.nodes'));
});

test('unknown base-node properties fail closed without inherited-property crashes', () => {
  const parsed = parseDocumentWithDiagnostics([
    'fn name=unknownProperty returns=void',
    '  handler lang=kern',
    '    return',
  ].join('\n'));
  const root = structuredClone(parsed.root.children[0]);
  root.props.constructor = true;
  root.props.future = true;
  assert.deepEqual(profileBlockersForFunction(root, loadCoveragePolicy().base), [
    'fn.properties.constructor',
    'fn.properties.future',
  ]);
});

test('corpus reads reject symlinks even when their target remains inside the root', () => {
  const root = mkdtempSync(join(tmpdir(), 'kern-coverage-corpus-'));
  try {
    writeFileSync(join(root, 'target.kern'), 'fn name=target returns=void\n  handler lang=kern\n    return\n');
    symlinkSync('target.kern', join(root, 'alias.kern'));
    assert.match(readCorpusMemberBytes('target.kern', root).toString('utf8'), /name=target/u);
    assert.throws(
      () => readCorpusMemberBytes('alias.kern', root),
      /corpus member alias\.kern must be a contained regular file/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('the cumulative base profile admits every promoted-family golden function', () => {
  const base = loadCoveragePolicy().base;
  for (const fixture of VALID_FIXTURES) {
    const parsed = parseDocumentWithDiagnostics(fixture.source);
    for (const root of parsed.root.children ?? []) {
      assert.deepEqual(profileBlockersForFunction(root, base), [], `${fixture.id}:${root.props?.name}`);
    }
  }
});

test('coverage rows pass through the canonical KIR codec and enforce its limits', () => {
  const parsed = parseDocumentWithDiagnostics([
    'fn name=canonicalRows returns=void',
    '  handler lang=kern',
    '    return',
  ].join('\n'));
  const root = parsed.root.children[0];
  const limits = loadCanonicalizerPolicy().kirLimits;
  assert.deepEqual(canonicalProfileRowsForFunction(root, limits), {
    nodes: 3,
    properties: 3,
    values: 4,
  });
  assert.throws(
    () => canonicalProfileRowsForFunction(root, { ...limits, maxStringBytes: 1 }),
    (error) => error?.code === 'limit-string',
  );
});

test('nested candidate containers reject orphan else and duplicate returns', () => {
  for (const body of [
    ['    if cond=true', '      else'],
    ['    if cond=true', '      return', '      return'],
  ]) {
    const parsed = parseDocumentWithDiagnostics([
      'fn name=nestedSequence returns=void',
      '  handler lang=kern',
      ...body,
    ].join('\n'));
    assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
    assert.ok(
      profileBlockersForFunction(parsed.root.children[0], loadCoveragePolicy().base).includes('if.children'),
      body.join('\n'),
    );
  }
});

test('profile row ceilings fail closed when a configured limit is missing', () => {
  const parsed = parseDocumentWithDiagnostics([
    'fn name=missingLimit returns=void',
    '  handler lang=kern',
    '    return',
  ].join('\n'));
  assert.throws(
    () => profileBlockersForFunction(
      parsed.root.children[0],
      loadCoveragePolicy().base,
      { maxNodeRows: 16, maxPropertyRows: 30 },
      { nodes: 3, properties: 4, values: 5 },
    ),
    /coverage profile rejection: invalid profile limits/u,
  );
});
