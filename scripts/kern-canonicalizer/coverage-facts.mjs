const FACT_KEYS = [
  'excludedProperties', 'expressionKinds', 'expressionOccurrences', 'firstUnsupported',
  'handlerChildProfiles', 'id', 'nodeKinds', 'nodeOccurrences', 'profileBlockers',
  'profileRows', 'propertyKeys', 'propertyOccurrences', 'tool',
];
const ROW_KEYS = ['nodes', 'properties', 'values'];
const UNSUPPORTED_KEYS = ['category', 'path', 'value'];
const PROPERTY_IDENTITY = /^[A-Za-z_$][A-Za-z0-9_$-]*\.[A-Za-z_$][A-Za-z0-9_$-]*$/u;

function fail(message) {
  throw new TypeError(`coverage facts rejection: ${message}`);
}

function record(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain record`);
  const actual = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    actual.some((key) => typeof key !== 'string') ||
    actual.some((key) => descriptors[key].get || descriptors[key].set || !descriptors[key].enumerable) ||
    actual.length !== keys.length ||
    actual.toSorted().some((key, index) => key !== keys[index])
  ) {
    fail(`${label} must contain exactly ${keys.join(',')}`);
  }
  return value;
}

function denseArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be an array`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must be a dense array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) fail(`${label} must be a dense array`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be non-empty text`);
  return value;
}

function textArray(value, label) {
  return denseArray(value, label).map((entry, index) => text(entry, `${label}[${index}]`));
}

function exactOccurrenceSet(kinds, occurrences, label) {
  const expected = [...new Set(occurrences)].toSorted();
  if (kinds.length !== expected.length || kinds.some((kind, index) => kind !== expected[index])) {
    fail(`${label} occurrences must exactly derive kinds`);
  }
}

function profileRows(value, label) {
  if (value === null) return null;
  const rows = record(value, ROW_KEYS, label);
  for (const key of ROW_KEYS) {
    if (!Number.isSafeInteger(rows[key]) || rows[key] < 0) fail(`${label}.${key} must be a non-negative safe integer`);
  }
  return rows;
}

function firstUnsupported(value, label) {
  if (value === null) return null;
  const unsupported = record(value, UNSUPPORTED_KEYS, label);
  for (const key of UNSUPPORTED_KEYS) text(unsupported[key], `${label}.${key}`);
  return unsupported;
}

function freezeData(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) freezeData(value[key]);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}

export function validateFunctionFacts(functions) {
  denseArray(functions, 'functions');
  const ids = new Set();
  functions.forEach((input, index) => {
    const label = `functions[${index}]`;
    const fact = record(input, FACT_KEYS, label);
    for (const key of ['excludedProperties', 'profileBlockers']) {
      textArray(fact[key], `${label}.${key}`);
    }
    for (const [kindsKey, occurrencesKey] of [
      ['expressionKinds', 'expressionOccurrences'],
      ['nodeKinds', 'nodeOccurrences'],
      ['propertyKeys', 'propertyOccurrences'],
    ]) {
      const kinds = textArray(fact[kindsKey], `${label}.${kindsKey}`);
      const occurrences = textArray(fact[occurrencesKey], `${label}.${occurrencesKey}`);
      if (kindsKey === 'propertyKeys' && kinds.some((identity) => !PROPERTY_IDENTITY.test(identity))) {
        fail(`${label}.propertyKeys must contain node.property identity text`);
      }
      exactOccurrenceSet(kinds, occurrences, `${label}.${occurrencesKey}`);
    }
    denseArray(fact.handlerChildProfiles, `${label}.handlerChildProfiles`).forEach((profile, profileIndex) =>
      textArray(profile, `${label}.handlerChildProfiles[${profileIndex}]`));
    firstUnsupported(fact.firstUnsupported, `${label}.firstUnsupported`);
    profileRows(fact.profileRows, `${label}.profileRows`);
    const id = text(fact.id, `${label}.id`);
    if (ids.has(id)) fail(`duplicate function id ${id}`);
    ids.add(id);
    text(fact.tool, `${label}.tool`);
  });
  return functions;
}

export function freezeFunctionFacts(functions) {
  validateFunctionFacts(functions);
  return freezeData(functions);
}
