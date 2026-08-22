import { fail, isCanonicalModuleId, listTape, sha256 } from './decoder.mjs';

const STATUSES = new Set(['linked', 'rejected', 'fatal']);
const LINK_FACT_CODES = new Set([
  'missing-module', 'missing-export', 'kind-mismatch', 'duplicate-local-binding',
  'duplicate-export', 'module-cycle',
]);
const FATAL_FACT_CODES = new Set(['F4_INVALID_REQUEST', 'F4_LIMIT', 'FORCED_LATE_FAILURE']);
const RESOURCE_KINDS = new Set(['maxModules', 'maxSymbols', 'maxBindings']);
const LINK_FACT_RANKS = new Map([
  'missing-module', 'missing-export', 'kind-mismatch', 'duplicate-local-binding', 'duplicate-export', 'module-cycle',
].map((code, rank) => [code, rank]));

function rows(text, label) {
  return listTape(text, `${label} tape`).map((row, index) =>
    listTape(row, `${label} row ${index}`));
}

function frame(value) {
  return `i${Array.from(value).length}:${value}`;
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

function compareValue(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTuple(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    const order = compareValue(left[index], right[index]);
    if (order !== 0) return order;
  }
  return 0;
}

function assertCanonical(items, compare, label) {
  let prior = null;
  for (const item of items) {
    if (prior !== null && compare(item, prior) <= 0) fail(`${label} order`);
    prior = item;
  }
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

function inputBindingPositions(context) {
  const args = context.f4bArguments;
  if (!Array.isArray(args) || args.length !== 18 || sha256(args) !== context.inputSeal) fail('module-set input');
  const moduleIds = args[0];
  const statuses = args[5];
  const interfaceBlocks = args[7];
  if (!sameStrings(moduleIds, context.moduleIds) || !Array.isArray(statuses) ||
      !Array.isArray(interfaceBlocks) || statuses.length !== moduleIds.length ||
      interfaceBlocks.length !== moduleIds.length) fail('module-set input');
  const positions = new Set();
  for (let index = 0; index < moduleIds.length; index += 1) {
    const outer = listTape(interfaceBlocks[index], `module input block ${index}`);
    if (outer.length !== 1) fail('module-set input');
    const fields = listTape(outer[0], `module input fields ${index}`);
    if (fields.length !== 2) fail('module-set input');
    const bindingRows = rows(fields[1], `module input bindings ${index}`);
    if (statuses[index] !== 'classified' && bindingRows.length) fail('module-set input');
    for (const row of bindingRows) {
      exact(row, 8, 'module input binding');
      if (row[0] !== moduleIds[index]) fail('module-set input');
      natural(row[6], 'module input ordinal');
      natural(row[7], 'module input start');
      positions.add(`${frame(row[0])}${frame(row[6])}${frame(row[7])}`);
    }
  }
  return positions;
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
    if (row.length !== 8 || row[0] !== moduleId || !isCanonicalModuleId(row[1]) ||
        (row[5] !== 'true' && row[5] !== 'false')) fail('resource witness input');
    natural(row[6], 'resource binding ordinal');
    natural(row[7], 'resource binding start');
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
  if (fields[0] !== 'kern.frontend.f4-module-set.4' || !STATUSES.has(fields[1])) fail('module-set identity');
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
    exact(row, fields[1] === 'fatal' ? 3 : 5, 'link fact');
    const allowedCodes = fields[1] === 'fatal' ? FATAL_FACT_CODES : LINK_FACT_CODES;
    if (!allowedCodes.has(row[0])) fail('link fact code');
    return {
      code: row[0], detail: row[1], moduleId: row[2],
      logicalOrdinal: row.length === 5 ? natural(row[3], 'link fact ordinal') : null,
      startScalar: row.length === 5 ? natural(row[4], 'link fact start') : null,
    };
  });
  const validatedComponents = rows(fields[5], 'component').map((row) => {
    exact(row, 2, 'component');
    if (!isCanonicalModuleId(row[0])) fail('component module id');
    const members = rows(row[1], 'component member').map((member) => {
      exact(member, 2, 'component member');
      if (!isCanonicalModuleId(member[0]) || !/^[0-9a-f]{64}$/u.test(member[1])) fail('component member identity');
      return { moduleId: member[0], receiptSeal: member[1] };
    });
    if (!members.length || row[0] !== members[0].moduleId) fail('component minimum');
    assertCanonical(members, (left, right) => compareValue(left.moduleId, right.moduleId), 'component member');
    return { componentMinimumId: row[0], moduleIds: members.map((member) => member.moduleId), members };
  });
  const bindings = rows(fields[6], 'resolved binding').map((row) => {
    exact(row, 8, 'resolved binding');
    if (!isCanonicalModuleId(row[0]) || !isCanonicalModuleId(row[5])) fail('binding module id');
    if (row[4] !== 'true' && row[4] !== 'false') fail('resolved binding reexport');
    return {
      sourceModuleId: row[0], imported: row[1], local: row[2], kind: row[3],
      reexport: row[4] === 'true', importerModuleId: row[5],
      logicalOrdinal: natural(row[6], 'resolved binding ordinal'),
      startScalar: natural(row[7], 'resolved binding start'),
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
    const identities = new Map(inputIdentityTape.map((identity) => [identity.moduleId, identity]));
    const inputPositions = bindings.length || linkFacts.length ? inputBindingPositions(context) : new Set();
    assertCanonical(rejected, (left, right) => compareValue(left.moduleId, right.moduleId), 'rejected');
    assertCanonical(blocked, (left, right) => compareValue(left.moduleId, right.moduleId), 'blocked');
    assertCanonical(validatedComponents,
      (left, right) => compareValue(left.componentMinimumId, right.componentMinimumId), 'component');
    assertCanonical(bindings, (left, right) => compareTuple([
      left.importerModuleId, left.startScalar, left.logicalOrdinal, left.sourceModuleId,
      left.imported, left.local, left.kind, String(left.reexport), left.importerModuleId,
    ], [
      right.importerModuleId, right.startScalar, right.logicalOrdinal, right.sourceModuleId,
      right.imported, right.local, right.kind, String(right.reexport), right.importerModuleId,
    ]), 'resolved binding');
    for (const binding of bindings) {
      if (!inputPositions.has(`${frame(binding.importerModuleId)}${frame(String(binding.logicalOrdinal))}${frame(String(binding.startScalar))}`)) {
        fail('resolved binding position');
      }
    }
    const rejectedIds = new Set(rejected.map((row) => row.moduleId));
    const blockedIds = new Set(blocked.map((row) => row.moduleId));
    const visibleIds = new Set();
    const componentOf = new Map();
    for (const row of rejected) {
      if (!identities.has(row.moduleId) || identities.get(row.moduleId).seal !== row.receiptSeal) fail('rejected identity');
    }
    for (const row of blocked) {
      if (!identities.has(row.moduleId) || !rejectedIds.has(row.rejectedDependency) || rejectedIds.has(row.moduleId)) {
        fail('blocked partition');
      }
    }
    for (const component of validatedComponents) {
      for (const member of component.members) {
        if (!identities.has(member.moduleId) || identities.get(member.moduleId).seal !== member.receiptSeal ||
            rejectedIds.has(member.moduleId) || blockedIds.has(member.moduleId) || visibleIds.has(member.moduleId)) {
          fail('component partition');
        }
        visibleIds.add(member.moduleId);
        componentOf.set(member.moduleId, component.componentMinimumId);
      }
    }
    if (visibleIds.size + rejectedIds.size + blockedIds.size !== inputIdentityTape.length) fail('module partition coverage');
    for (const identity of inputIdentityTape) {
      if (!visibleIds.has(identity.moduleId) && !rejectedIds.has(identity.moduleId) && !blockedIds.has(identity.moduleId)) {
        fail('module partition coverage');
      }
    }
    assertCanonical(linkFacts, (left, right) => {
      if (!componentOf.has(left.moduleId) || !componentOf.has(right.moduleId)) fail('link fact component');
      return compareTuple([
        componentOf.get(left.moduleId), left.moduleId, left.startScalar, LINK_FACT_RANKS.get(left.code) ?? -1,
        left.code, left.detail, left.logicalOrdinal,
      ], [
        componentOf.get(right.moduleId), right.moduleId, right.startScalar, LINK_FACT_RANKS.get(right.code) ?? -1,
        right.code, right.detail, right.logicalOrdinal,
      ]);
    }, 'link fact');
    for (const fact of linkFacts) {
      if (!inputPositions.has(`${frame(fact.moduleId)}${frame(String(fact.logicalOrdinal))}${frame(String(fact.startScalar))}`)) {
        fail('link fact position');
      }
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
