import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeModuleKir, encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';

import { flattenKirRoots, tableArguments } from './flatten.mjs';
import {
  CANONICALIZER_COMPOSITE_PATH,
  verifyCanonicalizerComposition,
} from './composition.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const WITNESS_ID = 'examples/selfhost-validator/validator.kern#18:hasimportcyclefrom';
const COMPOSITION = verifyCanonicalizerComposition();

function exactWitness() {
  const source = readFileSync(
    new URL('../../examples/selfhost-validator/validator.kern', import.meta.url),
    'utf8',
  );
  const parsed = parseDocumentWithDiagnostics(source);
  assert.ok(!parsed.partial);
  assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  const sourceRoot = (parsed.root.children ?? [])[18];
  assert.equal(sourceRoot?.type, 'fn');
  assert.equal(sourceRoot?.props?.name, 'hasimportcyclefrom', WITNESS_ID);
  assert.ok(sourceRoot, `missing ${WITNESS_ID}`);
  const root = sourceRoot;
  const policy = loadCanonicalizerPolicy();
  const bytes = encodeModuleKir([{ id: 'm4-39-witness.kern', roots: [root] }], policy.kirLimits);
  const decoded = decodeModuleKir(bytes, policy.kirLimits);
  const module = decoded.modules.find(({ id }) => id === 'm4-39-witness.kern');
  assert.ok(module);
  const tables = flattenKirRoots(module.roots);
  assert.deepEqual(
    {
      nodes: tables.nodeKind.length,
      properties: tables.propNode.length,
      values: tables.valueTag.length,
    },
    { nodes: 15, properties: 24, values: 154 },
  );
  return { bytes, policy, tables };
}

function executeWitness(maxCollectionLength) {
  const { policy, tables } = exactWitness();
  return executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [...tableArguments(tables), 16, 30, 154],
      identity: { handlerName: 'canonicalize', sourcePath: CANONICALIZER_COMPOSITE_PATH },
      source: COMPOSITION.source,
    },
    {
      enabled: true,
      limits: { ...policy.runtimeLimits, maxCollectionLength },
    },
  );
}

function executeTablesOk(tables, maxCollectionLength = 32_768) {
  const { runtimeLimits } = loadCanonicalizerPolicy();
  const envelope = executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: tableArguments(tables),
      identity: { handlerName: 'tablesok', sourcePath: CANONICALIZER_COMPOSITE_PATH },
      source: COMPOSITION.source,
    },
    { enabled: true, limits: { ...runtimeLimits, maxCollectionLength } },
  );
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope));
  assert.deepEqual(envelope.completion, { kind: 'return' });
  assert.equal(envelope.result.presence, 'value');
  assert.equal(envelope.result.value.tag, 'boolean');
  return envelope.result.value.value;
}

function validInteger(value) {
  return value === '0' || /^-?[1-9][0-9]*$/u.test(value);
}

// Frozen transcription of the pre-M4.39 quadratic validator. This remains
// deliberately independent from the Map-backed implementation under test.
function quadraticTablesOk(tables) {
  const {
    nodeKind, nodeParent, nodeOrder, propNode, propKey, propValue,
    valueTag, valueParent, valueRole, valueOrder, valueText, valueBool,
  } = tables;
  if (nodeKind.length === 0 || nodeKind.length !== nodeParent.length || nodeKind.length !== nodeOrder.length) return false;
  if (propNode.length !== propKey.length || propNode.length !== propValue.length) return false;
  if (
    valueTag.length !== valueParent.length || valueTag.length !== valueRole.length ||
    valueTag.length !== valueOrder.length || valueTag.length !== valueText.length ||
    valueTag.length !== valueBool.length
  ) return false;
  for (let i = 0; i < nodeKind.length; i += 1) {
    if (nodeParent[i] < 0 || nodeParent[i] > nodeKind.length || nodeOrder[i] < 0) return false;
    if (nodeParent[i] !== 0 && nodeParent[i] >= i + 1) return false;
    let siblings = 0;
    for (let j = 0; j < nodeKind.length; j += 1) {
      if (nodeParent[j] === nodeParent[i]) {
        siblings += 1;
        if (j > i && nodeOrder[j] === nodeOrder[i]) return false;
      }
    }
    if (nodeOrder[i] >= siblings) return false;
  }
  for (let i = 0; i < propNode.length; i += 1) {
    if (propNode[i] < 1 || propNode[i] > nodeKind.length || propValue[i] < 1 || propValue[i] > valueTag.length) return false;
    if (valueParent[propValue[i] - 1] !== 0 || valueRole[propValue[i] - 1] !== '') return false;
    for (let j = i + 1; j < propNode.length; j += 1) {
      if (propNode[j] === propNode[i] && propKey[j] === propKey[i]) return false;
    }
  }
  for (let i = 0; i < valueTag.length; i += 1) {
    if (valueParent[i] < 0 || valueParent[i] > valueTag.length || valueOrder[i] < 0) return false;
    if (valueParent[i] !== 0 && valueParent[i] >= i + 1) return false;
    const tag = valueTag[i];
    if (!['null', 'bool', 'text', 'int', 'list', 'record'].includes(tag)) return false;
    let children = 0;
    for (let child = 0; child < valueTag.length; child += 1) {
      if (valueParent[child] === i + 1) children += 1;
    }
    if (valueParent[i] > 0) {
      let siblings = 0;
      for (let compare = 0; compare < valueTag.length; compare += 1) {
        if (valueParent[compare] === valueParent[i]) {
          siblings += 1;
          if (compare > i && valueOrder[compare] === valueOrder[i]) return false;
        }
      }
      if (valueOrder[i] >= siblings) return false;
    }
    if (['null', 'bool', 'text', 'int'].includes(tag) && children !== 0) return false;
    if (tag === 'null' && (valueText[i] !== '' || valueBool[i] !== 0)) return false;
    if (tag === 'bool' && (valueText[i] !== '' || (valueBool[i] !== 0 && valueBool[i] !== 1))) return false;
    if ((tag === 'text' || tag === 'int') && valueBool[i] !== 0) return false;
    if ((tag === 'list' || tag === 'record') && (valueText[i] !== '' || valueBool[i] !== 0)) return false;
    if (tag === 'int' && !validInteger(valueText[i])) return false;
    if (valueParent[i] === 0) {
      let owners = 0;
      for (const propertyValue of propValue) if (propertyValue === i + 1) owners += 1;
      if (owners !== 1 || valueRole[i] !== '' || valueOrder[i] !== 0) return false;
      continue;
    }
    if (propValue.includes(i + 1)) return false;
    const parentTag = valueTag[valueParent[i] - 1];
    if (parentTag === 'list') {
      if (valueRole[i] !== 'list-item' || valueOrder[i] >= childrenFor(valueParent[i], valueParent)) return false;
      continue;
    }
    if (
      parentTag !== 'record' || !valueRole[i].startsWith('record:') || valueRole[i].length <= 7 ||
      valueOrder[i] >= childrenFor(valueParent[i], valueParent)
    ) return false;
    for (let compare = 0; compare < valueTag.length; compare += 1) {
      if (compare === i || valueParent[compare] !== valueParent[i]) continue;
      if (valueRole[compare] === valueRole[i]) return false;
      if (valueOrder[compare] < valueOrder[i] && valueRole[compare] >= valueRole[i]) return false;
    }
  }
  return true;
}

function childrenFor(parent, valueParent) {
  return valueParent.filter((candidate) => candidate === parent).length;
}

function copyWith(base, mutate) {
  const copy = structuredClone(base);
  mutate(copy);
  return copy;
}

function siblingGroup(parents, minimum = 2, excludeRoot = false) {
  for (const parent of new Set(parents)) {
    if (excludeRoot && parent === 0) continue;
    const indices = parents.flatMap((candidate, index) => candidate === parent ? [index] : []);
    if (indices.length >= minimum) return indices;
  }
  throw new Error(`missing sibling group of ${minimum}`);
}

function recordChildren(tables, minimum = 2) {
  for (let parent = 1; parent <= tables.valueTag.length; parent += 1) {
    if (tables.valueTag[parent - 1] !== 'record') continue;
    const children = tables.valueParent.flatMap((candidate, index) => candidate === parent ? [index] : []);
    if (children.length >= minimum) return children.sort((a, b) => tables.valueOrder[a] - tables.valueOrder[b]);
  }
  throw new Error(`missing record with ${minimum} children`);
}

test('M4.43 exact 15/24/154 direct-parameter witness preserves output with the indexed floor', () => {
  const { bytes, policy } = exactWitness();
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 16,
    maxPropertyRows: 30,
    maxValueRows: 154,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);

  assert.notEqual(executeWitness(7_359).outcome, 'success');
  assert.equal(executeWitness(7_360).outcome, 'success');

  const envelope = executeWitness(40_000);
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope));
  assert.deepEqual(envelope.diagnostics, []);
  assert.deepEqual(envelope.events, []);
  assert.deepEqual(envelope.completion, { kind: 'return' });
  assert.equal(envelope.result.presence, 'value');
  assert.equal(envelope.result.value.tag, 'list');
  const source = `${envelope.result.value.value.map((value) => {
    assert.equal(value.tag, 'text');
    return value.value;
  }).join('\n')}\n`;
  const parsed = parseDocumentWithDiagnostics(source);
  assert.ok(!parsed.partial);
  assert.deepEqual(parsed.diagnostics.filter(({ severity }) => severity === 'error'), []);
  assert.deepEqual(
    Buffer.from(encodeModuleKir([{ id: 'm4-39-witness.kern', roots: parsed.root.children ?? [] }], policy.kirLimits)),
    Buffer.from(bytes),
  );
});

test('M4.41 preserves the M4.39 Map-index table decisions', () => {
  const base = exactWitness().tables;
  const nodeSiblings = siblingGroup(base.nodeParent);
  const valueSiblings = siblingGroup(base.valueParent, 2, true);
  const recordSiblings = recordChildren(base);
  const sameNodeProperties = siblingGroup(base.propNode);
  const rootValues = base.valueParent.flatMap((parent, index) => parent === 0 ? [index + 1] : []);
  const nestedValue = base.valueParent.findIndex((parent) => parent > 0) + 1;
  const listChild = base.valueParent.findIndex((parent) => parent > 0 && base.valueTag[parent - 1] === 'list');
  const scalar = base.valueTag.findIndex((tag) => ['null', 'bool', 'text', 'int'].includes(tag)) + 1;

  const cases = [
    { id: 'exact-valid-witness', expected: true, tables: base },
    {
      id: 'length-framed-delimiter-and-unicode-property-keys', expected: true,
      tables: copyWith(base, (tables) => {
        sameNodeProperties.forEach((index, order) => { tables.propKey[index] = `${order}:é:${order}:x`; });
      }),
    },
    {
      id: 'numeric-looking-record-roles', expected: true,
      tables: copyWith(base, (tables) => {
        recordSiblings.forEach((index, order) => { tables.valueRole[index] = `record:${String(order).padStart(2, '0')}:x`; });
      }),
    },
    {
      id: 'duplicate-node-order', expected: false,
      tables: copyWith(base, (tables) => { tables.nodeOrder[nodeSiblings[1]] = tables.nodeOrder[nodeSiblings[0]]; }),
    },
    {
      id: 'sparse-node-order', expected: false,
      tables: copyWith(base, (tables) => { tables.nodeOrder[nodeSiblings[1]] = nodeSiblings.length; }),
    },
    {
      id: 'duplicate-property-key', expected: false,
      tables: copyWith(base, (tables) => { tables.propKey[sameNodeProperties[1]] = tables.propKey[sameNodeProperties[0]]; }),
    },
    {
      id: 'duplicate-value-order', expected: false,
      tables: copyWith(base, (tables) => { tables.valueOrder[valueSiblings[1]] = tables.valueOrder[valueSiblings[0]]; }),
    },
    {
      id: 'sparse-value-order', expected: false,
      tables: copyWith(base, (tables) => { tables.valueOrder[valueSiblings[1]] = valueSiblings.length; }),
    },
    {
      id: 'scalar-child', expected: false,
      tables: copyWith(base, (tables) => {
        tables.valueTag.push('null');
        tables.valueParent.push(scalar);
        tables.valueRole.push('list-item');
        tables.valueOrder.push(0);
        tables.valueText.push('');
        tables.valueBool.push(0);
      }),
    },
    {
      id: 'multiply-owned-root', expected: false,
      tables: copyWith(base, (tables) => { tables.propValue[1] = rootValues[0]; }),
    },
    {
      id: 'property-owned-child', expected: false,
      tables: copyWith(base, (tables) => { tables.propValue[0] = nestedValue; }),
    },
    {
      id: 'wrong-list-role', expected: false,
      tables: copyWith(base, (tables) => { tables.valueRole[listChild] = 'record:item'; }),
    },
    {
      id: 'duplicate-record-role', expected: false,
      tables: copyWith(base, (tables) => { tables.valueRole[recordSiblings[1]] = tables.valueRole[recordSiblings[0]]; }),
    },
    {
      id: 'reverse-record-role-order', expected: false,
      tables: copyWith(base, (tables) => {
        tables.valueRole[recordSiblings[0]] = 'record:z';
        tables.valueRole[recordSiblings[1]] = 'record:a';
      }),
    },
  ];

  for (const fixture of cases) {
    assert.equal(quadraticTablesOk(fixture.tables), fixture.expected, `${fixture.id} oracle`);
    assert.equal(executeTablesOk(fixture.tables), fixture.expected, `${fixture.id} optimized`);
  }
});
