import { fail, isCanonicalModuleId, listTape, sha256 } from './decoder.mjs';

const STATUSES = new Set(['linked', 'rejected', 'fatal']);
const LINK_FACT_CODES = new Set([
  'missing-module', 'missing-export', 'kind-mismatch', 'duplicate-local-binding',
  'duplicate-export', 'module-cycle', 'F4_INVALID_REQUEST', 'F4_LIMIT', 'FORCED_LATE_FAILURE',
]);
const RESOURCE_KINDS = new Set(['maxModules', 'maxSymbols', 'maxBindings']);

function rows(text, label) {
  return listTape(text, `${label} tape`).map((row, index) =>
    listTape(row, `${label} row ${index}`));
}

function exact(fields, count, label) {
  if (fields.length !== count) fail(`${label} field count`);
  return fields;
}

function natural(value, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) fail(`${label} witness integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(`${label} witness integer`);
  return parsed;
}

function sameStrings(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function proofArguments(context) {
  const args = context.f4bArguments;
  if (!Array.isArray(args) || args.length !== 18 || sha256(args) !== context.inputSeal) fail('resource witness input');
  const [moduleIds, mode, resourceKind, f4aModuleIds, f4aFormats, f4aStatuses, f4aSeals, interfaceBlocks,
    maxModules, maxSymbols, maxBindings, maxWorkSteps, forceLateFailure,
    maxModuleIdScalars, maxModuleIdSegments, maxImportSpecifierScalars,
    maxImportSpecifierSegments, maxEncodedBytes] = args;
  const arrays = [moduleIds, f4aModuleIds, f4aFormats, f4aStatuses, f4aSeals, interfaceBlocks];
  if (arrays.some((value) => !Array.isArray(value) || value.some((item) => typeof item !== 'string')) ||
      typeof mode !== 'string' || typeof resourceKind !== 'string' || typeof forceLateFailure !== 'boolean' ||
      [maxModules, maxSymbols, maxBindings, maxWorkSteps, maxModuleIdScalars, maxModuleIdSegments,
        maxImportSpecifierScalars, maxImportSpecifierSegments, maxEncodedBytes]
        .some((value) => !Number.isSafeInteger(value))) fail('resource witness input');
  if (!sameStrings(moduleIds, context.moduleIds) || moduleIds.length !== context.moduleCount ||
      mode !== 'resource-prefix') fail('resource witness input');
  return {
    moduleIds, resourceKind, f4aModuleIds, f4aFormats, f4aStatuses, f4aSeals, interfaceBlocks,
    maxModules, maxSymbols, maxBindings,
  };
}

function blockCounts(block, moduleId, status, index) {
  const outer = listTape(block, `resource block ${index}`);
  if (outer.length !== 1) fail('resource witness input');
  const fields = listTape(outer[0], `resource block ${index} fields`);
  if (fields.length !== 2) fail('resource witness input');
  const symbolRows = rows(fields[0], `resource block ${index} symbols`);
  const bindingRows = rows(fields[1], `resource block ${index} bindings`);
  if (status !== 'classified' && (symbolRows.length || bindingRows.length)) fail('resource witness input');
  for (const row of symbolRows) {
    if (row.length !== 4 || row[0] !== moduleId || (row[1] !== 'class' && row[1] !== 'fn') ||
        row[2] === '' || (row[3] !== 'true' && row[3] !== 'false')) fail('resource witness input');
  }
  for (const row of bindingRows) {
    if (row.length !== 6 || row[0] !== moduleId || !isCanonicalModuleId(row[1]) ||
        (row[5] !== 'true' && row[5] !== 'false')) fail('resource witness input');
  }
  return { symbols: symbolRows.length, bindings: bindingRows.length };
}

function recomputeProof(context) {
  const input = proofArguments(context);
  const moduleCount = input.moduleIds.length;
  const prefixCount = input.interfaceBlocks.length;
  const identityArrays = [input.f4aModuleIds, input.f4aFormats, input.f4aStatuses, input.f4aSeals];
  if (input.resourceKind === 'maxModules') {
    if (prefixCount !== 0 || identityArrays.some((values) => values.length !== 0) ||
        moduleCount <= input.maxModules) fail('resource witness input');
    return {
      kind: 'maxModules', moduleCount, prefixCount: 0,
      priorSymbols: 0, priorBindings: 0, crossingSymbols: 0, crossingBindings: 0,
    };
  }
  if (!RESOURCE_KINDS.has(input.resourceKind) || prefixCount === 0 || prefixCount > moduleCount ||
      identityArrays.some((values) => values.length !== prefixCount)) fail('resource witness input');
  let symbols = 0;
  let bindings = 0;
  let priorSymbols = 0;
  let priorBindings = 0;
  for (let index = 0; index < prefixCount; index += 1) {
    if (input.f4aModuleIds[index] !== input.moduleIds[index] ||
        input.f4aFormats[index] !== 'kern.frontend.f4-document.2' ||
        !['classified', 'rejected', 'fatal'].includes(input.f4aStatuses[index]) ||
        !/^[0-9a-f]{64}$/u.test(input.f4aSeals[index])) fail('resource witness input');
    if (index === prefixCount - 1) {
      priorSymbols = symbols;
      priorBindings = bindings;
    }
    const counts = blockCounts(input.interfaceBlocks[index], input.moduleIds[index], input.f4aStatuses[index], index);
    symbols += counts.symbols;
    bindings += counts.bindings;
    if (index + 1 < prefixCount && (symbols > input.maxSymbols || bindings > input.maxBindings)) {
      fail('resource witness input');
    }
  }
  const kind = symbols > input.maxSymbols ? 'maxSymbols' : bindings > input.maxBindings ? 'maxBindings' : '';
  if (kind === '' || kind !== input.resourceKind) fail('resource witness input');
  return { kind, moduleCount, prefixCount, priorSymbols, priorBindings, crossingSymbols: symbols, crossingBindings: bindings };
}

function proofWitness(field, context, terminal) {
  const witnessRows = rows(field, 'resource witness');
  if (witnessRows.length !== 1) fail('resource witness count');
  const row = exact(witnessRows[0], 8, 'resource witness');
  if (row[0] !== 'resource-prefix' || !RESOURCE_KINDS.has(row[1])) fail('resource witness identity');
  const fullModuleCount = natural(row[2], 'full module count');
  const prefixCount = natural(row[3], 'prefix count');
  const priorSymbols = natural(row[4], 'prior symbols');
  const priorBindings = natural(row[5], 'prior bindings');
  const crossingSymbols = natural(row[6], 'crossing symbols');
  const crossingBindings = natural(row[7], 'crossing bindings');
  const expectedProof = recomputeProof(context);
  if (context.mode !== 'resource-prefix' || context.resourceKind !== row[1] ||
      fullModuleCount !== expectedProof.moduleCount || prefixCount !== expectedProof.prefixCount ||
      priorSymbols !== expectedProof.priorSymbols || priorBindings !== expectedProof.priorBindings ||
      crossingSymbols !== expectedProof.crossingSymbols || crossingBindings !== expectedProof.crossingBindings ||
      row[1] !== expectedProof.kind) fail('resource witness input proof drift');
  const expected = `module-set:fatal:${fullModuleCount}:0:0:1:0:0:0:${Array.from(field).length}:${row[1]}:closed`;
  if (terminal !== expected) fail('resource witness terminal');
  return {
    tag: row[0], kind: row[1], fullModuleCount, prefixCount,
    priorSymbols, priorBindings, crossingSymbols, crossingBindings,
  };
}

export function decodeModuleSet(fields, context) {
  if (!Array.isArray(fields) || fields.length !== 10 ||
      fields.some((field) => typeof field !== 'string')) fail('module-set field shape');
  if (fields[0] !== 'kern.frontend.f4-module-set.3' || !STATUSES.has(fields[1])) fail('module-set identity');
  const rejected = rows(fields[2], 'rejected').map((row) => {
    exact(row, 2, 'rejected');
    if (!isCanonicalModuleId(row[0])) fail('rejected module id');
    return { moduleId: row[0], receiptSeal: row[1] };
  });
  const blocked = rows(fields[3], 'blocked').map((row) => {
    exact(row, 2, 'blocked');
    if (!isCanonicalModuleId(row[0]) || !isCanonicalModuleId(row[1])) fail('blocked module id');
    return { moduleId: row[0], rejectedDependency: row[1] };
  });
  const linkFacts = rows(fields[4], 'link fact').map((row) => {
    exact(row, 3, 'link fact');
    if (!LINK_FACT_CODES.has(row[0])) fail('link fact code');
    return { code: row[0], detail: row[1], moduleId: row[2] };
  });
  const validatedComponents = rows(fields[5], 'component').map((row) => {
    exact(row, 2, 'component');
    if (!isCanonicalModuleId(row[0])) fail('component module id');
    return { moduleIds: [row[0]], receiptSeal: row[1] };
  });
  const bindings = rows(fields[6], 'resolved binding').map((row) => {
    exact(row, 6, 'resolved binding');
    if (!isCanonicalModuleId(row[0]) || !isCanonicalModuleId(row[5])) fail('binding module id');
    if (row[4] !== 'true' && row[4] !== 'false') fail('resolved binding reexport');
    return {
      sourceModuleId: row[0], imported: row[1], local: row[2], kind: row[3],
      reexport: row[4] === 'true', importerModuleId: row[5],
    };
  });
  const inputIdentityTape = rows(fields[7], 'input identity').map((row) => {
    exact(row, 4, 'input identity');
    if (!isCanonicalModuleId(row[0]) || !/^[0-9a-f]{64}$/u.test(row[3])) fail('input identity module id');
    return { moduleId: row[0], format: row[1], status: row[2], seal: row[3] };
  });
  let resourcePrefixWitness = null;
  if (fields[1] === 'fatal') {
    if (rejected.length || blocked.length || inputIdentityTape.length || validatedComponents.length ||
        bindings.length || linkFacts.length !== 1) fail('module-set fatal atomicity');
    if (fields[8] === '') {
      if (fields[9] !== 'failure') fail('module-set fatal terminal');
    } else {
      if (linkFacts[0].code !== 'F4_LIMIT') fail('resource witness fact');
      resourcePrefixWitness = proofWitness(fields[8], context, fields[9]);
    }
  } else {
    if (context.mode !== 'full' || context.resourceKind !== '' || fields[8] !== '') fail('module-set identity');
    const expectedTerminal = `module-set:${fields[1]}:${context.moduleCount}:${rejected.length}:${blocked.length}:${linkFacts.length}:${validatedComponents.length}:${bindings.length}:${Array.from(fields[7]).length}:0:full:closed`;
    if (fields[9] !== expectedTerminal) fail('module-set terminal seal');
    if (!Array.isArray(context.inputIdentities) || inputIdentityTape.length !== context.inputIdentities.length ||
        !Array.isArray(context.moduleIds) || context.moduleIds.length !== inputIdentityTape.length) {
      fail('input identity count');
    }
    for (let index = 0; index < inputIdentityTape.length; index += 1) {
      const actual = inputIdentityTape[index];
      const expected = context.inputIdentities[index];
      if (!expected || actual.moduleId !== context.moduleIds[index] || actual.moduleId !== expected.moduleId ||
          actual.format !== expected.format || actual.status !== expected.status ||
          actual.seal !== expected.seal) fail('input identity drift');
    }
  }
  if (fields[1] === 'linked' && (rejected.length || blocked.length || linkFacts.length)) {
    fail('linked partition');
  }
  if (fields[1] === 'rejected' && bindings.length) fail('rejected interface');
  return {
    header: {
      format: fields[0], terminalSeal: fields[9], inputSeal: context.inputSeal,
      inputIdentityTape, resourcePrefixWitness,
    },
    status: fields[1], rejected, blocked, linkFacts, validatedComponents,
    modules: fields[1] === 'linked' ? validatedComponents.flatMap((row) => row.moduleIds) : [],
    bindings,
    seal: sha256(fields),
  };
}
