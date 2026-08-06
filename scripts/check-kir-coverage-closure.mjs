#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { decodeStructuralKir, encodeStructuralKir } from '../packages/core/dist/kir-structural/canonical.js';
import { StructuralKirError } from '../packages/core/dist/kir-structural/types.js';
import { validateCoverageLedger } from './kir-v1/validate-coverage-ledger.mjs';

const constitution = JSON.parse(readFileSync('scripts/kir-structural/constitution.json', 'utf8'));
const ledger = JSON.parse(readFileSync('scripts/kir-v1/coverage-witness-ledger.json', 'utf8'));
const limits = JSON.parse(readFileSync('scripts/kir-v1/coverage-witness-config.json', 'utf8'));

function expectCode(run, code, witnessId) {
  try {
    run();
  } catch (error) {
    if (error instanceof StructuralKirError && error.code === code) return;
    throw new Error(`${witnessId}: expected ${code}; received ${String(error)}`);
  }
  throw new Error(`${witnessId}: expected ${code}; operation succeeded`);
}

function groupProperties(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.nodeKind) ?? [];
    current.push(row);
    grouped.set(row.nodeKind, current);
  }
  return grouped;
}

function requiredProps(rows) {
  return Object.fromEntries(rows.filter((row) => row.required).map((row) => [row.propertyName, row.fixture]));
}

function rejectedNode(disposition) {
  return disposition === 'required-excluded-host-payload' || disposition === 'explicit-missing-schema';
}

function record(fields) {
  return { tag: 'record', value: Object.entries(fields).map(([key, value]) => ({ key, value })) };
}

function expression(kind, fields) {
  return record({ fields: record(fields), kind: { tag: 'text', value: kind } });
}

function integerExpression(value) {
  return expression('integer', { value: { tag: 'int', value } });
}

function expectedLambdaMapExpression() {
  const identifier = (name) => expression('identifier', { name: { tag: 'text', value: name } });
  const list = expression('list', {
    items: { tag: 'list', value: ['1', '2', '3'].map(integerExpression) },
  });
  const lambda = expression('lambda', {
    body: expression('binary', {
      left: identifier('x'),
      op: { tag: 'text', value: '*' },
      right: integerExpression('2'),
    }),
    params: { tag: 'list', value: [{ tag: 'text', value: 'x' }] },
  });
  return expression('call', {
    args: { tag: 'list', value: [list, lambda] },
    callee: expression('member', {
      object: identifier('List'),
      optional: { tag: 'bool', value: false },
      property: { tag: 'text', value: 'map' },
    }),
    optional: { tag: 'bool', value: false },
  });
}

function expectedCanonicalValue(row) {
  if (row.disposition === 'lowered-expression' && row.fixture === 'paid') {
    return {
      tag: 'record',
      value: [
        { key: 'fields', value: { tag: 'record', value: [{ key: 'name', value: { tag: 'text', value: 'paid' } }] } },
        { key: 'kind', value: { tag: 'text', value: 'identifier' } },
      ],
    };
  }
  if (row.disposition === 'lowered-expression' && row.fixture === '1 + 6') {
    const integer = (value) => ({
      tag: 'record',
      value: [
        { key: 'fields', value: { tag: 'record', value: [{ key: 'value', value: { tag: 'int', value } }] } },
        { key: 'kind', value: { tag: 'text', value: 'integer' } },
      ],
    });
    return {
      tag: 'record',
      value: [
        {
          key: 'fields',
          value: {
            tag: 'record',
            value: [
              { key: 'left', value: integer('1') },
              { key: 'op', value: { tag: 'text', value: '+' } },
              { key: 'right', value: integer('6') },
            ],
          },
        },
        { key: 'kind', value: { tag: 'text', value: 'binary' } },
      ],
    };
  }
  if (row.disposition === 'lowered-expression' && row.fixture === 'null') {
    return {
      tag: 'record',
      value: [
        { key: 'fields', value: { tag: 'record', value: [] } },
        { key: 'kind', value: { tag: 'text', value: 'null' } },
      ],
    };
  }
  if (row.disposition === 'lowered-expression' && row.nodeKind === 'lambda') {
    return expectedLambdaMapExpression();
  }
  if (row.disposition === 'lowered-import-path') return { tag: 'text', value: row.fixture };
  if (row.disposition === 'lowered-branch-path-value') {
    return {
      tag: 'record',
      value: [
        { key: 'form', value: { tag: 'text', value: 'unquoted-expression' } },
        { key: 'source', value: { tag: 'text', value: row.fixture } },
      ],
    };
  }
  if (row.disposition === 'lowered-each-collection-reference') {
    return {
      tag: 'record',
      value: [
        { key: 'form', value: { tag: 'text', value: 'binding' } },
        { key: 'source', value: { tag: 'text', value: row.fixture } },
      ],
    };
  }
  if (row.disposition === 'lowered-type') {
    return {
      tag: 'record',
      value: [{ key: 'kind', value: { tag: 'text', value: 'text' } }],
    };
  }
  if (row.disposition !== 'included-value') {
    throw new Error(`${row.witnessIds[0]}: admitted disposition has no canonical value recipe`);
  }
  if (row.schemaKind === 'boolean') return { tag: 'bool', value: row.fixture };
  if (row.schemaKind === 'number') return { tag: 'int', value: String(row.fixture) };
  if (row.schemaKind === 'identifier' || row.schemaKind === 'string') {
    return { tag: 'text', value: row.fixture };
  }
  throw new Error(`${row.witnessIds[0]}: included schema kind has no canonical value recipe`);
}

function assertCanonicalProperty(root, row, witnessId) {
  if (!Array.isArray(root.properties)) throw new Error(`${witnessId}: decoded properties are not an array`);
  const property = root.properties.find((entry) => entry.key === row.propertyName);
  if (!property) throw new Error(`${witnessId}: populated property was dropped`);
  const expected = expectedCanonicalValue(row);
  if (JSON.stringify(property.value) !== JSON.stringify(expected)) {
    throw new Error(`${witnessId}: canonical property value drifted`);
  }
}

function roundTrip(node, witnessId) {
  const artifact = decodeStructuralKir(encodeStructuralKir(node, limits), limits);
  if (artifact.root.kind !== node.type) throw new Error(`${witnessId}: root kind changed`);
  return artifact.root;
}

function propertyWitness(row, properties) {
  if (row.nodeKind === 'lambda') {
    return {
      node: {
        type: 'handler',
        props: { lang: 'kern' },
        children: [{ type: 'lambda', props: properties }],
      },
      target(root) {
        const lambda = root.children[0];
        if (!lambda || lambda.kind !== 'lambda') throw new Error(`${row.witnessIds?.[0] ?? row.witnessId}: lambda context changed`);
        return lambda;
      },
    };
  }
  if (row.nodeKind === 'param' && row.propertyName === 'type') {
    return {
      node: {
        type: 'fn',
        props: { name: 'handler' },
        children: [{ type: 'param', props: properties }],
      },
      target(root) {
        const parameter = root.children[0];
        if (!parameter || parameter.kind !== 'param') throw new Error(`${row.witnessIds[0]}: param context changed`);
        return parameter;
      },
    };
  }
  return { node: { type: row.nodeKind, props: properties }, target: (root) => root };
}

export function runCoverageClosure() {
  validateCoverageLedger(ledger, constitution);
  const nodes = [...ledger.nodes, ...ledger.runnerSyntheticNodes];
  const properties = [...ledger.properties, ...ledger.runnerSyntheticProperties];
  const propertiesByNode = groupProperties(properties);
  let executed = 0;
  for (const nodeRow of nodes) {
    const properties = propertiesByNode.get(nodeRow.id) ?? [];
    const input = nodeRow.id === 'lambda'
      ? {
          type: 'handler',
          props: { lang: 'kern' },
          children: [{ type: 'lambda', props: requiredProps(properties) }],
        }
      : { type: nodeRow.id, props: requiredProps(properties) };
    if (nodeRow.disposition === 'explicit-missing-schema') {
      expectCode(() => encodeStructuralKir(input, limits), 'unknown-node-kind', nodeRow.witnessId);
    } else if (nodeRow.disposition === 'required-excluded-host-payload') {
      expectCode(() => encodeStructuralKir(input, limits), 'excluded-host-payload', nodeRow.witnessId);
    } else {
      roundTrip(input, nodeRow.witnessId);
    }
    executed += 1;
  }

  for (const row of properties) {
    const node = nodes.find((item) => item.id === row.nodeKind);
    if (!node) throw new Error(`missing node ${row.nodeKind}`);
    const properties = propertiesByNode.get(row.nodeKind) ?? [];
    const base = requiredProps(properties);
    const populated = { ...base, [row.propertyName]: row.fixture };
    const populatedWitness = propertyWitness(row, populated);
    const populatedId = row.witnessIds[0];
    if (rejectedNode(node.disposition) || row.disposition.startsWith('excluded-')) {
      const code = node.disposition === 'explicit-missing-schema' ? 'unknown-node-kind' : 'excluded-host-payload';
      expectCode(() => encodeStructuralKir(populatedWitness.node, limits), code, populatedId);
    } else {
      const root = roundTrip(populatedWitness.node, populatedId);
      assertCanonicalProperty(populatedWitness.target(root), row, populatedId);
    }
    executed += 1;

    if (row.disposition === 'lowered-branch-path-value') {
      const quotedId = row.witnessIds[1];
      const quotedWitness = propertyWitness(row, populated);
      quotedWitness.node.__quotedProps = ['value'];
      const root = roundTrip(quotedWitness.node, quotedId);
      const target = quotedWitness.target(root);
      const property = target.properties.find((entry) => entry.key === row.propertyName);
      const expected = {
        tag: 'record',
        value: [
          { key: 'form', value: { tag: 'text', value: 'quoted-text' } },
          { key: 'source', value: { tag: 'text', value: row.fixture } },
        ],
      };
      if (!property || JSON.stringify(property.value) !== JSON.stringify(expected)) {
        throw new Error(`${quotedId}: quoted branch-path provenance drifted`);
      }
      executed += 1;
    }

    if (!row.required) {
      const omitted = { ...base };
      delete omitted[row.propertyName];
      const omittedWitness = propertyWitness(row, omitted);
      const omittedId = row.witnessIds.at(-1);
      if (rejectedNode(node.disposition)) {
        const code = node.disposition === 'explicit-missing-schema' ? 'unknown-node-kind' : 'excluded-host-payload';
        expectCode(() => encodeStructuralKir(omittedWitness.node, limits), code, omittedId);
      } else {
        const root = roundTrip(omittedWitness.node, omittedId);
        if (omittedWitness.target(root).properties.some((property) => property.key === row.propertyName)) {
          throw new Error(`${omittedId}: omitted property gained a default`);
        }
      }
      executed += 1;
    }
  }
  process.stdout.write(
    `KIR coverage closure: PASS (${ledger.nodes.length}/302 source nodes; ${ledger.properties.length}/1149 source properties; ${ledger.runnerSyntheticNodes.length}/1 runner-synthetic nodes; ${ledger.runnerSyntheticProperties.length}/1 runner-synthetic properties; ${executed} executable witnesses; ALPHA-NO-GO).\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCoverageClosure();
