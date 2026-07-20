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

function expectedCanonicalValue(row) {
  if (row.disposition === 'lowered-expression' && row.fixture === 'null') {
    return {
      tag: 'record',
      value: [
        { key: 'fields', value: { tag: 'record', value: [] } },
        { key: 'kind', value: { tag: 'text', value: 'null' } },
      ],
    };
  }
  if (row.disposition === 'lowered-import-path') return { tag: 'text', value: row.fixture };
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
  const propertiesByNode = groupProperties(ledger.properties);
  let executed = 0;
  for (const nodeRow of ledger.nodes) {
    const properties = propertiesByNode.get(nodeRow.id) ?? [];
    const input = { type: nodeRow.id, props: requiredProps(properties) };
    if (nodeRow.disposition === 'explicit-missing-schema') {
      expectCode(() => encodeStructuralKir(input, limits), 'unknown-node-kind', nodeRow.witnessId);
    } else if (nodeRow.disposition === 'required-excluded-host-payload') {
      expectCode(() => encodeStructuralKir(input, limits), 'excluded-host-payload', nodeRow.witnessId);
    } else {
      roundTrip(input, nodeRow.witnessId);
    }
    executed += 1;
  }

  for (const row of ledger.properties) {
    const node = ledger.nodes.find((item) => item.id === row.nodeKind);
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

    if (!row.required) {
      const omitted = { ...base };
      delete omitted[row.propertyName];
      const omittedWitness = propertyWitness(row, omitted);
      const omittedId = row.witnessIds[1];
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
    `KIR coverage closure: PASS (${ledger.nodes.length}/302 nodes; ${ledger.properties.length}/1149 properties; ${executed} executable witnesses; ALPHA-NO-GO).\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCoverageClosure();
