const NODE_DISPOSITIONS = new Set([
  'included-structural',
  'lowered-semantic',
  'required-excluded-host-payload',
  'explicit-missing-schema',
]);

function fail(message) {
  throw new Error(`KIR coverage ledger: ${message}`);
}

function exact(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
  const actual = Object.keys(value);
  if (JSON.stringify(actual) !== JSON.stringify(keys)) fail(`${path} fields must be ${keys.join(',')}`);
}

function expectedDisposition(node, properties) {
  if (node.schemaStatus === 'missing') return 'explicit-missing-schema';
  if (properties.some((property) => property.required && property.disposition.startsWith('excluded-'))) {
    return 'required-excluded-host-payload';
  }
  if (
    properties.some(
      (property) =>
        property.disposition === 'lowered-expression' ||
        property.disposition === 'lowered-import-path' ||
        property.disposition === 'lowered-type',
    )
  ) {
    return 'lowered-semantic';
  }
  return 'included-structural';
}

function validateFixture(row, path) {
  if (row.values !== null && !row.values.includes(String(row.fixture))) fail(`${path}.fixture is outside values`);
  if (row.schemaKind === 'boolean' && typeof row.fixture !== 'boolean') fail(`${path}.fixture must be boolean`);
  if (row.schemaKind === 'number' && typeof row.fixture !== 'number') fail(`${path}.fixture must be number`);
  if (row.schemaKind === 'identifier' && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(row.fixture)) {
    fail(`${path}.fixture must be an identifier`);
  }
  if (!['boolean', 'number'].includes(row.schemaKind) && typeof row.fixture !== 'string') {
    fail(`${path}.fixture must be text`);
  }
}

export function validateCoverageLedger(ledger, constitution) {
  exact(
    ledger,
    ['schemaVersion', 'format', 'constitutionFormat', 'proofLabel', 'counts', 'nodes', 'properties'],
    'ledger',
  );
  if (ledger.schemaVersion !== 1 || ledger.format !== 'kern.kir.coverage-witness-ledger.r1.5f.1') {
    fail('unsupported ledger version');
  }
  if (ledger.constitutionFormat !== constitution.format || ledger.proofLabel !== 'ALPHA-NO-GO') {
    fail('constitution or proof label drifted');
  }
  exact(ledger.counts, ['nodes', 'properties'], 'ledger.counts');
  if (ledger.counts.nodes !== 302 || ledger.counts.properties !== 1149) fail('exact counts drifted');
  if (ledger.nodes.length !== constitution.nodes.length || ledger.properties.length !== constitution.properties.length) {
    fail('ledger arrays do not match constitution counts');
  }

  const propertiesByNode = new Map(constitution.nodes.map((node) => [node.id, []]));
  for (const property of constitution.properties) propertiesByNode.get(property.nodeKind)?.push(property);
  const witnessIds = new Set();
  const nodeById = new Map();
  ledger.nodes.forEach((row, index) => {
    exact(row, ['id', 'disposition', 'witnessId'], `ledger.nodes[${index}]`);
    const source = constitution.nodes[index];
    if (!source || row.id !== source.id) fail(`node row ${index} is not source ordered`);
    if (!NODE_DISPOSITIONS.has(row.disposition)) fail(`node ${row.id} has invalid disposition`);
    if (row.disposition !== expectedDisposition(source, propertiesByNode.get(row.id) ?? [])) {
      fail(`node ${row.id} disposition mismatches constitution`);
    }
    if (typeof row.witnessId !== 'string' || witnessIds.has(row.witnessId)) fail(`node ${row.id} witness is invalid`);
    witnessIds.add(row.witnessId);
    nodeById.set(row.id, row);
  });

  ledger.properties.forEach((row, index) => {
    exact(
      row,
      [
        'nodeKind',
        'propertyName',
        'schemaKind',
        'required',
        'values',
        'disposition',
        'reasonId',
        'fixture',
        'witnessIds',
      ],
      `ledger.properties[${index}]`,
    );
    const source = constitution.properties[index];
    for (const key of ['nodeKind', 'propertyName', 'schemaKind', 'required', 'values', 'disposition', 'reasonId']) {
      if (JSON.stringify(row[key]) !== JSON.stringify(source?.[key])) fail(`property row ${index} ${key} drifted`);
    }
    validateFixture(row, `ledger.properties[${index}]`);
    const expectedWitnesses = row.required ? 1 : 2;
    if (!Array.isArray(row.witnessIds) || row.witnessIds.length !== expectedWitnesses) {
      fail(`property ${row.nodeKind}.${row.propertyName} witness count drifted`);
    }
    for (const id of row.witnessIds) {
      if (typeof id !== 'string' || witnessIds.has(id)) fail(`property witness ${String(id)} is invalid`);
      witnessIds.add(id);
    }
  });
  const ledgerPropertiesByNode = new Map(ledger.nodes.map((node) => [node.id, []]));
  for (const property of ledger.properties) ledgerPropertiesByNode.get(property.nodeKind)?.push(property);
  return { nodeById, propertiesByNode: ledgerPropertiesByNode, witnessIds };
}
