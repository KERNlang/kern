import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM441ParameterTarget,
  M441_PARAMETER_MIGRATION_TARGETS,
} from './coverage-m4-41-parameter-migrations.mjs';

function validIdentifierFixture() {
  const target = M441_PARAMETER_MIGRATION_TARGETS.find(({ name }) => name === 'valididentifier');
  assert.ok(target);
  const source = readFileSync(new URL(`../../${target.path}`, import.meta.url), 'utf8');
  const document = parseDocumentWithDiagnostics(source);
  assert.deepEqual(document.diagnostics, []);
  const roots = document.root.children.filter(({ type }) => type === 'fn');
  const root = roots[target.functionOrdinal];
  const fact = measureCanonicalizerCoverage().functions.find(({ id }) => id === target.id);
  assertM441ParameterTarget(root, fact, target);
  return { fact, root, target };
}

test('M4.41 target guard rejects every signature, body, identity, and profile mutation', () => {
  const fixture = validIdentifierFixture();
  const mutations = [
    ({ root }) => { root.props.params = 'value:string'; },
    ({ root }) => { root.props.name = 'substituted'; },
    ({ root }) => { root.props.returns = 'string'; },
    ({ root }) => { root.children[0].props.name = 'renamed'; },
    ({ root }) => { root.children[0].props.type = 'number'; },
    ({ root }) => { root.children.unshift(structuredClone(root.children[0])); },
    ({ root }) => { root.children.push(root.children.shift()); },
    ({ root }) => { root.children.find(({ type }) => type === 'handler').props.lang = 'typescript'; },
    ({ fact }) => { fact.id = `${fact.id}-substituted`; },
    ({ fact }) => { fact.excludedProperties.push('fn.params'); },
    ({ fact }) => { fact.profileBlockers.push('profile.rows.values'); },
    ({ fact }) => { fact.profileRows.values += 1; },
    ({ fact }) => { fact.nodeOccurrences.splice(fact.nodeOccurrences.indexOf('param'), 1); },
  ];

  for (const mutate of mutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => assertM441ParameterTarget(copy.root, copy.fact, copy.target));
  }
});
