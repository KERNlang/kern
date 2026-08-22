const ranks = new Map([
  'missing-module', 'missing-export', 'kind-mismatch', 'duplicate-local-binding',
  'duplicate-export', 'module-cycle',
].map((code, rank) => [code, rank]));

const tuple = (...values) => values;
const compareTuple = (left, right) => {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
};
const key = (moduleId, name) => JSON.stringify([moduleId, name]);
const bindingTuple = (row) => tuple(
  row.moduleId, row.startScalar, row.logicalOrdinal, row.targetModuleId,
  row.imported, row.local, row.requestedKind, String(row.reexport),
);
const edgeTuple = (row) => tuple(row.source, row.target, row.startScalar, row.logicalOrdinal);

function canonicalInputs(modules, documents) {
  const identities = new Map();
  const bindings = [];
  const symbols = [];
  for (let index = 0; index < modules.length; index += 1) {
    const receipt = documents[index]?.receipt;
    if (!receipt || receipt.header.moduleId !== modules[index].moduleId) throw new Error('reference input identity');
    identities.set(modules[index].moduleId, receipt);
    for (const binding of receipt.bindings) bindings.push({ ...binding });
    for (const symbol of receipt.symbols) symbols.push({ ...symbol, moduleId: modules[index].moduleId });
  }
  bindings.sort((left, right) => compareTuple(bindingTuple(left), bindingTuple(right)));
  return { identities, bindings, symbols };
}

function canonicalEdges(moduleIds, bindings) {
  const all = new Set(moduleIds);
  const candidates = bindings.filter(({ targetModuleId }) => all.has(targetModuleId)).map((binding) => ({
    source: binding.moduleId, target: binding.targetModuleId,
    logicalOrdinal: binding.logicalOrdinal, startScalar: binding.startScalar,
  })).sort((left, right) => compareTuple(edgeTuple(left), edgeTuple(right)));
  const edges = [];
  const seen = new Set();
  for (const edge of candidates) {
    const edgeKey = key(edge.source, edge.target);
    if (!seen.has(edgeKey)) {
      seen.add(edgeKey);
      edges.push(edge);
    }
  }
  return edges;
}

function stronglyConnected(moduleIds, edges) {
  const forward = new Map(moduleIds.map((id) => [id, []]));
  const reverse = new Map(moduleIds.map((id) => [id, []]));
  for (const { source, target } of edges) {
    forward.get(source).push(target);
    reverse.get(target).push(source);
  }
  for (const adjacent of [...forward.values(), ...reverse.values()]) adjacent.sort();
  const visited = new Set();
  const finished = [];
  const visit = (node) => {
    if (visited.has(node)) return;
    visited.add(node);
    for (const target of forward.get(node)) visit(target);
    finished.push(node);
  };
  for (const moduleId of moduleIds) visit(moduleId);
  const assigned = new Set();
  const components = [];
  const collect = (node, members) => {
    if (assigned.has(node)) return;
    assigned.add(node);
    members.push(node);
    for (const source of reverse.get(node)) collect(source, members);
  };
  for (const root of finished.toReversed()) {
    if (assigned.has(root)) continue;
    const members = [];
    collect(root, members);
    components.push(members.sort());
  }
  components.sort((left, right) => left[0].localeCompare(right[0]));
  return { components, forward };
}

function partition(moduleIds, identities, components, edges) {
  const componentOf = new Map();
  for (const members of components) for (const moduleId of members) componentOf.set(moduleId, members[0]);
  const componentEdges = new Map(components.map((members) => [members[0], new Set()]));
  for (const { source, target } of edges) {
    const from = componentOf.get(source);
    const to = componentOf.get(target);
    if (from !== to) componentEdges.get(from).add(to);
  }
  const rejectedIds = moduleIds.filter((id) => identities.get(id).status !== 'classified');
  const rejected = new Set(rejectedIds);
  const memo = new Map();
  const minimumRejected = (component) => {
    if (memo.has(component)) return memo.get(component);
    const direct = components.find((members) => members[0] === component)
      .filter((id) => rejected.has(id));
    let minimum = direct.length ? direct.sort()[0] : '';
    for (const target of componentEdges.get(component)) {
      const candidate = minimumRejected(target);
      if (candidate && (!minimum || candidate < minimum)) minimum = candidate;
    }
    memo.set(component, minimum);
    return minimum;
  };
  const blocked = new Map();
  for (const moduleId of moduleIds) {
    const reason = minimumRejected(componentOf.get(moduleId));
    if (!rejected.has(moduleId) && reason) blocked.set(moduleId, reason);
  }
  return { componentOf, rejected, rejectedIds, blocked };
}

function cycleFacts(components, edges, forward, visible, componentOf) {
  const witnessByEdge = new Map(edges.map((edge) => [key(edge.source, edge.target), edge]));
  const facts = [];
  for (const members of components) {
    if (!members.every((id) => visible.has(id))) continue;
    const colors = new Map();
    let candidate = null;
    const visit = (node) => {
      colors.set(node, 1);
      for (const target of forward.get(node)) {
        if (componentOf.get(target) !== members[0]) continue;
        if (!colors.has(target)) visit(target);
        else if (colors.get(target) === 1) {
          const edge = witnessByEdge.get(key(node, target));
          if (!candidate || compareTuple(edgeTuple(edge), edgeTuple(candidate)) < 0) candidate = edge;
        }
      }
      colors.set(node, 2);
    };
    visit(members[0]);
    if (candidate) facts.push({
      code: 'module-cycle', detail: candidate.target, moduleId: candidate.source,
      logicalOrdinal: candidate.logicalOrdinal, startScalar: candidate.startScalar,
    });
  }
  return facts;
}

function resolveBindings(moduleIds, bindings, symbols, rejected, blocked) {
  const eligible = (id) => !rejected.has(id) && !blocked.has(id);
  const exports = new Map();
  const declared = new Map();
  for (const symbol of symbols) {
    declared.set(key(symbol.moduleId, symbol.name), symbol.kind);
    if (symbol.exported) exports.set(key(symbol.moduleId, symbol.name), symbol.kind);
  }
  const firstLocal = new Map();
  bindings.forEach((binding, index) => {
    const localKey = key(binding.moduleId, binding.local);
    if (!firstLocal.has(localKey)) firstLocal.set(localKey, index);
  });
  const grounded = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    bindings.forEach((binding, index) => {
      if (!eligible(binding.moduleId) || !binding.reexport || !binding.imported || grounded.has(index)) return;
      const actual = exports.get(key(binding.targetModuleId, binding.imported));
      const effective = binding.requestedKind || actual;
      const localKey = key(binding.moduleId, binding.local);
      if (actual && effective === actual && firstLocal.get(localKey) === index &&
          !declared.has(localKey) && !exports.has(localKey)) {
        exports.set(localKey, effective);
        grounded.add(index);
        changed = true;
      }
    });
  }
  const localNames = new Map(declared);
  const facts = [];
  const resolved = [];
  for (const binding of bindings) {
    if (!eligible(binding.moduleId)) continue;
    const fact = (code, detail) => facts.push({
      code, detail, moduleId: binding.moduleId,
      logicalOrdinal: binding.logicalOrdinal, startScalar: binding.startScalar,
    });
    if (!moduleIds.includes(binding.targetModuleId)) {
      fact('missing-module', binding.targetModuleId);
      continue;
    }
    if (!binding.imported) continue;
    const actual = exports.get(key(binding.targetModuleId, binding.imported));
    if (!actual) {
      fact('missing-export', binding.imported);
      continue;
    }
    const effective = binding.requestedKind || actual;
    let exportable = true;
    if (effective !== actual) {
      fact('kind-mismatch', binding.imported);
      exportable = false;
    }
    const localKey = key(binding.moduleId, binding.local);
    if (localNames.has(localKey)) {
      fact('duplicate-local-binding', binding.local);
      exportable = false;
    } else localNames.set(localKey, effective);
    if (binding.reexport && exportable && !grounded.has(bindings.indexOf(binding))) {
      if (exports.has(localKey)) fact('duplicate-export', binding.local);
      else exports.set(localKey, effective);
    }
    resolved.push({
      sourceModuleId: binding.targetModuleId, imported: binding.imported, local: binding.local,
      kind: effective, reexport: binding.reexport, importerModuleId: binding.moduleId,
      logicalOrdinal: binding.logicalOrdinal, startScalar: binding.startScalar,
    });
  }
  resolved.sort((left, right) => compareTuple(tuple(
    left.importerModuleId, left.startScalar, left.logicalOrdinal, left.sourceModuleId,
    left.imported, left.local, left.kind, String(left.reexport),
  ), tuple(
    right.importerModuleId, right.startScalar, right.logicalOrdinal, right.sourceModuleId,
    right.imported, right.local, right.kind, String(right.reexport),
  )));
  return { facts, resolved };
}

export function referenceModuleGraph(modules, documents) {
  const moduleIds = modules.map(({ moduleId }) => moduleId).sort();
  const { identities, bindings, symbols } = canonicalInputs(modules, documents);
  const edges = canonicalEdges(moduleIds, bindings);
  const { components, forward } = stronglyConnected(moduleIds, edges);
  const { componentOf, rejected, rejectedIds, blocked } = partition(moduleIds, identities, components, edges);
  const visible = new Set(moduleIds.filter((id) => !rejected.has(id) && !blocked.has(id)));
  const cycles = cycleFacts(components, edges, forward, visible, componentOf);
  const resolution = resolveBindings(moduleIds, bindings, symbols, rejected, blocked);
  const facts = [...cycles, ...resolution.facts].sort((left, right) => compareTuple(tuple(
    componentOf.get(left.moduleId), left.moduleId, left.startScalar, ranks.get(left.code),
    left.code, left.detail, left.logicalOrdinal,
  ), tuple(
    componentOf.get(right.moduleId), right.moduleId, right.startScalar, ranks.get(right.code),
    right.code, right.detail, right.logicalOrdinal,
  )));
  return {
    rejected: rejectedIds.sort().map((moduleId) => ({ moduleId, receiptSeal: identities.get(moduleId).seal })),
    blocked: [...blocked].sort(([left], [right]) => left.localeCompare(right))
      .map(([moduleId, rejectedDependency]) => ({ moduleId, rejectedDependency })),
    linkFacts: facts,
    validatedComponents: components.filter((members) => members.every((id) => visible.has(id))).map((members) => ({
      componentMinimumId: members[0],
      members: members.map((moduleId) => ({ moduleId, receiptSeal: identities.get(moduleId).seal })),
    })),
    bindings: facts.length || rejected.size || blocked.size ? [] : resolution.resolved,
  };
}
