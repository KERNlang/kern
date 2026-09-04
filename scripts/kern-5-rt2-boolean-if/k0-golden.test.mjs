import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { STRUCTURAL_KIR_NODE_CATALOG } from '../../packages/core/dist/kir-structural/catalog.generated.js';
import { compileJavaScript, compilePython, handlerSource, project } from './k0-support.mjs';

const GOLDEN_URL = new URL('./k0-golden.json', import.meta.url);
const CONTRACTS_URL = new URL(
  '../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts',
  import.meta.url,
);

const PROBE_BODIES = Object.freeze({
  assign: ['let name=held value="\"a\""', 'assign target="held" value="\"b\""'],
  capability: ['capability namespace=fixture operation=resolve name=reply'],
  else: ['else', '  print value="\"f\""'],
  for: ['let name=x value="0"', 'for name=i from="0" to="1"', '  assign target="x" value="x + 1"'],
  if: ['if cond="flag"', '  print value="\"t\""'],
  'if-else': ['if cond="flag"', '  print value="\"t\""', 'else', '  print value="\"f\""'],
  let: ['let name=held value="\"a\""'],
  print: ['print value="\"a\""'],
  return: [],
  while: ['while cond="flag"', '  print value="\"w\""'],
});

const STATEMENT_PROBES = Object.freeze([
  'assign',
  'capability',
  'else',
  'for',
  'if',
  'let',
  'print',
  'return',
  'while',
]);

function linkedStatementKinds(source) {
  const start = source.indexOf('export type LinkedKernKirStatement =');
  assert.ok(start >= 0, 'contracts.ts must declare LinkedKernKirStatement');
  const end = source.indexOf('\nexport ', start + 1);
  assert.ok(end > start, 'the LinkedKernKirStatement union must be followed by another export');
  const kinds = [...source.slice(start, end).matchAll(/readonly kind: '([a-z-]+)'/gu)].map((match) => match[1]);
  assert.ok(kinds.length > 0, 'the LinkedKernKirStatement union must carry discriminant literals');
  return [...new Set(kinds)].sort();
}

function catalogSchema(kind) {
  const entry = STRUCTURAL_KIR_NODE_CATALOG.get(kind);
  assert.ok(entry !== undefined, `the structural catalog must bind ${kind}`);
  const properties = Object.keys(entry.properties)
    .sort()
    .map((name) => {
      const property = entry.properties[name];
      return [
        name,
        {
          disposition: property.disposition,
          required: property.required,
          schemaKind: property.schemaKind,
          values: property.values === null ? null : [...property.values].sort(),
        },
      ];
    });
  return {
    allowedChildren: entry.allowedChildren === null ? null : [...entry.allowedChildren].sort(),
    disposition: entry.disposition,
    kind,
    properties: Object.fromEntries(properties),
    schemaStatus: entry.schemaStatus,
  };
}

async function probeAdmission(kind) {
  const source = handlerSource(
    'string',
    [{ name: 'flag', type: 'boolean' }],
    [...PROBE_BODIES[kind], 'return value="\"done\""'],
  );
  const verified = await project(source);
  if (verified === undefined) return 'projection-rejected';
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  const javascriptCode = javascript.outcome === 'failure' ? javascript.code : 'admitted';
  const pythonCode = python.outcome === 'failure' ? python.code : 'admitted';
  assert.equal(javascriptCode, pythonCode, `both targets share one linker; ${kind} diverged`);
  return javascriptCode;
}

async function recompute() {
  const admission = {};
  for (const kind of Object.keys(PROBE_BODIES).sort()) {
    admission[kind] = await probeAdmission(kind);
  }
  return {
    admission,
    linkedStatementKinds: linkedStatementKinds(await readFile(CONTRACTS_URL, 'utf8')),
    structuralSchema: { else: catalogSchema('else'), if: catalogSchema('if') },
  };
}

test('K0 golden pins the linker-admitted statement kinds and the structural if schema', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  assert.deepEqual(
    await recompute(),
    golden,
    'K0_KIR_GOLDEN_DRIFT: recomputed KIR admission or structural if schema differs from the committed golden',
  );
});

test('K0 golden statement kinds equal the statement kinds the linker admits', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  const admitted = STATEMENT_PROBES.filter((kind) => golden.admission[kind] === 'admitted').sort();
  assert.deepEqual(
    admitted,
    golden.linkedStatementKinds.slice().sort(),
    'K0_KIR_GOLDEN_DRIFT: the declared linked statement union and the admitted statement kinds disagree',
  );
});
