export const PROBE_FORMAT = 'kern.semantic-kir.probe.1';

const VALUE_TAGS = new Set([
  'null',
  'bool',
  'text',
  'int',
  'negative-zero',
  'decimal',
  'regex',
  'list',
  'record',
  'expression',
]);
export const PROBE_NODE_KINDS = new Set(['fn', 'param', 'handler', 'return', 'let', 'capability', 'print']);
const PROBE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const EXPRESSION_FIELDS = {
  identifier: ['name'],
  integer: ['value'],
  'negative-zero': [],
  decimal: ['value'],
  text: ['value'],
  boolean: ['value'],
  null: [],
  regex: ['value'],
  list: ['items'],
  record: ['entries'],
  member: ['object', 'property', 'optional'],
  index: ['object', 'index', 'optional'],
  call: ['callee', 'arguments', 'optional'],
  lambda: ['parameters', 'body'],
  binary: ['operator', 'left', 'right'],
  unary: ['operator', 'argument'],
  conditional: ['test', 'consequent', 'alternate'],
};
const NODE_PROPERTIES = {
  fn: { allowed: ['name', 'params', 'returns', 'async', 'stream', 'export', 'effects'], required: ['name'] },
  param: { allowed: ['name', 'type', 'value', 'required', 'optional', 'variadic', 'description', 'min', 'max'], required: ['name'] },
  handler: { allowed: ['lang', 'reason', 'review'], required: ['lang'] },
  return: { allowed: ['value', 'trailingComment'], required: [] },
  let: { allowed: ['name', 'value', 'type', 'kind', 'trailingComment'], required: ['name'] },
  capability: { allowed: ['namespace', 'operation', 'name', 'input'], required: ['namespace', 'operation', 'name'] },
  print: { allowed: ['value', 'trailingComment'], required: ['value'] },
};
const NODE_CHILDREN = {
  fn: new Set(['param', 'handler']),
  param: new Set(),
  handler: new Set(['return', 'let', 'capability', 'print']),
  return: new Set(),
  let: new Set(),
  capability: new Set(),
  print: new Set(),
};
const NODE_PROPERTY_TAGS = {
  fn: { name: 'text', params: 'text', returns: 'text', async: 'bool', stream: 'bool', export: 'bool', effects: 'text' },
  param: {
    name: 'text', type: 'text', value: 'expression', required: 'bool', optional: 'bool', variadic: 'bool',
    description: 'text', min: 'int', max: 'int',
  },
  handler: { lang: 'text', reason: 'text', review: 'text' },
  return: { value: 'expression', trailingComment: 'text' },
  let: { name: 'text', value: 'expression', type: 'text', kind: 'text', trailingComment: 'text' },
  capability: { namespace: 'text', operation: 'text', name: 'text', input: 'expression' },
  print: { value: 'expression', trailingComment: 'text' },
};

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function object(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'expected object');
  }
  return value;
}

function exactKeys(value, expected, path) {
  const actual = Object.keys(object(value, path)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(path, `expected fields ${wanted.join(',')}; received ${actual.join(',')}`);
  }
}

function array(value, path) {
  if (!Array.isArray(value)) fail(path, 'expected array');
  return value;
}

export function assertWellFormedText(value, path = 'text') {
  if (typeof value !== 'string') fail(path, 'expected string');
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(path, 'contains an unpaired high surrogate');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail(path, 'contains an unpaired low surrogate');
    }
  }
  return value;
}

export function compareCodePoints(left, right) {
  const a = Array.from(left, (char) => char.codePointAt(0));
  const b = Array.from(right, (char) => char.codePointAt(0));
  const limit = Math.min(a.length, b.length);
  for (let index = 0; index < limit; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function text(value, path) {
  return assertWellFormedText(value, path);
}

function identifier(value, path) {
  text(value, path);
  if (!PROBE_IDENTIFIER_RE.test(value) || value.startsWith('__k') || value.startsWith('_kern')) {
    fail(path, 'expected portable identifier');
  }
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail(path, 'expected boolean');
  return value;
}

function validateLocation(value, path) {
  exactKeys(value, ['start', 'end'], path);
  const validatePoint = (point, pointPath, nullable) => {
    if (nullable && point === null) return;
    exactKeys(point, ['line', 'column'], pointPath);
    for (const key of ['line', 'column']) {
      if (!Number.isSafeInteger(point[key]) || point[key] < 1) fail(`${pointPath}.${key}`, 'expected positive safe integer');
    }
  };
  validatePoint(value.start, `${path}.start`, false);
  validatePoint(value.end, `${path}.end`, true);
  if (value.end !== null && (value.end.line < value.start.line ||
    (value.end.line === value.start.line && value.end.column < value.start.column))) {
    fail(`${path}.end`, 'end location precedes start location');
  }
}

function validateEntryKeys(entries, allowed, required, path) {
  const keys = entries.map((entry) => entry.key);
  const allowedSet = new Set(allowed);
  for (const key of keys) if (!allowedSet.has(key)) fail(path, `unexpected semantic field ${key}`);
  for (const key of required) if (!keys.includes(key)) fail(path, `missing semantic field ${key}`);
}

function validateEntryArray(entries, path, validateItem) {
  const seen = new Set();
  let previous;
  for (const [index, entry] of array(entries, path).entries()) {
    const entryPath = `${path}[${index}]`;
    exactKeys(entry, ['key', 'value'], entryPath);
    text(entry.key, `${entryPath}.key`);
    if (seen.has(entry.key)) fail(entryPath, `duplicate key ${JSON.stringify(entry.key)}`);
    if (previous !== undefined && compareCodePoints(previous, entry.key) >= 0) {
      fail(entryPath, 'keys must be strictly code-point sorted');
    }
    seen.add(entry.key);
    previous = entry.key;
    validateItem(entry.value, `${entryPath}.value`);
  }
}

function validateExpression(value, path) {
  exactKeys(value, ['kind', 'fields'], path);
  text(value.kind, `${path}.kind`);
  const allowed = new Set([
    'identifier', 'integer', 'negative-zero', 'decimal', 'text', 'boolean', 'null', 'regex',
    'list', 'record', 'member', 'index', 'call', 'lambda', 'binary', 'unary', 'conditional',
  ]);
  if (!allowed.has(value.kind)) fail(`${path}.kind`, `unknown expression kind ${value.kind}`);
  validateEntryArray(value.fields, `${path}.fields`, validateValue);
  const expected = EXPRESSION_FIELDS[value.kind];
  validateEntryKeys(value.fields, expected, expected, `${path}.fields`);
  const byName = new Map(value.fields.map((field) => [field.key, field.value]));
  const requireTag = (name, tag) => {
    if (byName.get(name)?.tag !== tag) fail(`${path}.fields.${name}`, `expected ${tag} value`);
  };
  if (value.kind === 'identifier') {
    requireTag('name', 'text');
    identifier(byName.get('name').value, `${path}.fields.name`);
  } else if (value.kind === 'integer') requireTag('value', 'int');
  else if (value.kind === 'decimal') requireTag('value', 'decimal');
  else if (value.kind === 'text') requireTag('value', 'text');
  else if (value.kind === 'boolean') requireTag('value', 'bool');
  else if (value.kind === 'regex') requireTag('value', 'regex');
  else if (value.kind === 'list') requireExpressionCollection(byName.get('items'), `${path}.fields.items`, 'list');
  else if (value.kind === 'record') requireExpressionCollection(byName.get('entries'), `${path}.fields.entries`, 'record');
  else if (value.kind === 'member') {
    requireTag('object', 'expression'); requireTag('property', 'text'); requireTag('optional', 'bool');
  } else if (value.kind === 'index') {
    requireTag('object', 'expression'); requireTag('index', 'expression'); requireTag('optional', 'bool');
  } else if (value.kind === 'call') {
    requireTag('callee', 'expression'); requireExpressionCollection(byName.get('arguments'), `${path}.fields.arguments`, 'list'); requireTag('optional', 'bool');
  } else if (value.kind === 'lambda') {
    const parameters = byName.get('parameters');
    if (parameters?.tag !== 'list' || parameters.value.some((item) => item.tag !== 'text')) {
      fail(`${path}.fields.parameters`, 'expected list of text values');
    }
    parameters.value.forEach((parameter, index) => identifier(parameter.value, `${path}.fields.parameters[${index}]`));
    requireTag('body', 'expression');
  } else if (value.kind === 'binary') {
    requireTag('operator', 'text'); requireTag('left', 'expression'); requireTag('right', 'expression');
  } else if (value.kind === 'unary') {
    requireTag('operator', 'text'); requireTag('argument', 'expression');
  } else if (value.kind === 'conditional') {
    requireTag('test', 'expression'); requireTag('consequent', 'expression'); requireTag('alternate', 'expression');
  }
}

function requireExpressionCollection(value, path, tag) {
  if (value?.tag !== tag) fail(path, `expected ${tag} value`);
  if (value.value.some((item) => (tag === 'list' ? item : item.value).tag !== 'expression')) {
    fail(path, `expected ${tag} of expression values`);
  }
}

export function validateValue(value, path = 'value') {
  object(value, path);
  text(value.tag, `${path}.tag`);
  if (!VALUE_TAGS.has(value.tag)) fail(`${path}.tag`, `unknown value tag ${value.tag}`);
  if (value.tag === 'null' || value.tag === 'negative-zero') {
    exactKeys(value, ['tag'], path);
    return;
  }
  exactKeys(value, ['tag', 'value'], path);
  if (value.tag === 'bool') boolean(value.value, `${path}.value`);
  if (value.tag === 'text') text(value.value, `${path}.value`);
  if (value.tag === 'int') {
    text(value.value, `${path}.value`);
    if (!/^(?:0|-?[1-9][0-9]*)$/u.test(value.value)) fail(`${path}.value`, 'expected canonical base-10 integer text');
    const parsed = Number(value.value);
    if (!Number.isSafeInteger(parsed)) fail(`${path}.value`, 'integer exceeds safe probe boundary');
  }
  if (value.tag === 'decimal') {
    text(value.value, `${path}.value`);
    if (!/^-?(?:0|[1-9][0-9]*)\.[0-9]+$/u.test(value.value)) fail(`${path}.value`, 'expected exact non-exponent decimal text');
  }
  if (value.tag === 'regex') {
    exactKeys(value.value, ['pattern', 'flags'], `${path}.value`);
    text(value.value.pattern, `${path}.value.pattern`);
    text(value.value.flags, `${path}.value.flags`);
    if (!/^(?!.*(.).*\1)[dgimsuvy]*$/u.test(value.value.flags)) fail(`${path}.value.flags`, 'invalid or duplicate flags');
    if ([...value.value.flags].sort().join('') !== value.value.flags) fail(`${path}.value.flags`, 'flags must be sorted');
    try {
      new RegExp(value.value.pattern, value.value.flags);
    } catch {
      fail(`${path}.value.pattern`, 'invalid regex pattern for declared flags');
    }
  }
  if (value.tag === 'list') array(value.value, `${path}.value`).forEach((item, index) => validateValue(item, `${path}.value[${index}]`));
  if (value.tag === 'record') validateEntryArray(value.value, `${path}.value`, validateValue);
  if (value.tag === 'expression') validateExpression(value.value, `${path}.value`);
}

function validateNode(value, path) {
  exactKeys(value, ['kind', 'location', 'properties', 'children'], path);
  text(value.kind, `${path}.kind`);
  if (!PROBE_NODE_KINDS.has(value.kind)) fail(`${path}.kind`, `unknown probe node kind ${value.kind}`);
  validateLocation(value.location, `${path}.location`);
  validateEntryArray(value.properties, `${path}.properties`, validateValue);
  const shape = NODE_PROPERTIES[value.kind];
  validateEntryKeys(value.properties, shape.allowed, shape.required, `${path}.properties`);
  for (const property of value.properties) {
    const expectedTag = NODE_PROPERTY_TAGS[value.kind][property.key];
    if (property.value.tag !== expectedTag) fail(`${path}.properties.${property.key}`, `expected ${expectedTag} value`);
  }
  const identifierProperties = {
    fn: ['name'], param: ['name'], handler: [], return: [], let: ['name'],
    capability: ['namespace', 'operation', 'name'], print: [],
  }[value.kind];
  for (const name of identifierProperties) {
    const property = value.properties.find((entry) => entry.key === name);
    if (property?.value.tag !== 'text') fail(`${path}.properties`, `${name} must be text`);
    identifier(property.value.value, `${path}.properties.${name}`);
  }
  array(value.children, `${path}.children`).forEach((child, index) => {
    validateNode(child, `${path}.children[${index}]`);
    if (!NODE_CHILDREN[value.kind].has(child.kind)) fail(`${path}.children[${index}].kind`, `${child.kind} is not allowed under ${value.kind}`);
  });
  if (value.kind === 'fn') {
    let handlerCount = 0;
    let sawHandler = false;
    for (const [index, child] of value.children.entries()) {
      if (child.kind === 'handler') {
        handlerCount += 1;
        sawHandler = true;
      } else if (child.kind === 'param' && sawHandler) {
        fail(`${path}.children[${index}]`, 'params must precede the handler');
      }
    }
    if (handlerCount > 1) fail(`${path}.children`, 'fn may contain at most one handler');
  }
}

function validateBinding(value, path) {
  exactKeys(value, ['imported', 'local', 'kind', 'reexport'], path);
  identifier(value.imported, `${path}.imported`);
  identifier(value.local, `${path}.local`);
  text(value.kind, `${path}.kind`);
  if (value.kind !== 'fn') fail(`${path}.kind`, 'probe binding kind must be fn');
  boolean(value.reexport, `${path}.reexport`);
}

function validateImport(value, path) {
  exactKeys(value, ['source', 'bindings'], path);
  text(value.source, `${path}.source`);
  array(value.bindings, `${path}.bindings`).forEach((binding, index) => validateBinding(binding, `${path}.bindings[${index}]`));
}

function bindingKey(value) {
  return [value.imported, value.local, value.kind, value.reexport ? '1' : '0'].join('\0');
}

function validateExport(value, path) {
  exactKeys(value, ['name', 'kind', 'source'], path);
  identifier(value.name, `${path}.name`);
  text(value.kind, `${path}.kind`);
  if (value.kind !== 'fn') fail(`${path}.kind`, 'probe export kind must be fn');
  if (value.source !== null) text(value.source, `${path}.source`);
}

function validateDiagnostic(value, path) {
  exactKeys(value, ['module', 'code', 'severity', 'category', 'message', 'location'], path);
  text(value.module, `${path}.module`);
  text(value.code, `${path}.code`);
  if (!['error', 'warning', 'info'].includes(value.severity)) fail(`${path}.severity`, 'unknown severity');
  text(value.category, `${path}.category`);
  text(value.message, `${path}.message`);
  validateLocation(value.location, `${path}.location`);
}

function diagnosticKey(value) {
  const end = value.location.end;
  return [
    value.module,
    value.code,
    value.severity,
    value.category,
    String(value.location.start.line),
    String(value.location.start.column),
    end === null ? '' : String(end.line),
    end === null ? '' : String(end.column),
    value.message,
  ].join('\0');
}

export function validateEnvelope(value) {
  exactKeys(value, ['format', 'modules', 'diagnostics'], 'envelope');
  if (value.format !== PROBE_FORMAT) fail('envelope.format', `unsupported format ${JSON.stringify(value.format)}`);
  if (array(value.modules, 'envelope.modules').length === 0) fail('envelope.modules', 'expected at least one module');
  const ids = new Set();
  const exportsByModule = new Map();
  const importsByModule = new Map();
  const declarationsByModule = new Map();
  let previous;
  for (const [index, module] of array(value.modules, 'envelope.modules').entries()) {
    const path = `envelope.modules[${index}]`;
    exactKeys(module, ['id', 'imports', 'exports', 'nodes'], path);
    text(module.id, `${path}.id`);
    const segments = module.id.split('/');
    if (/^[A-Za-z]:/u.test(module.id) || module.id.includes('\\') || module.id.startsWith('/') ||
      module.id.endsWith('/') || /[\u0000-\u001f\u007f]/u.test(module.id) ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      fail(`${path}.id`, 'expected normalized relative POSIX id');
    }
    if (ids.has(module.id)) fail(`${path}.id`, 'duplicate module id');
    if (previous !== undefined && compareCodePoints(previous, module.id) >= 0) fail(`${path}.id`, 'modules must be strictly code-point sorted');
    ids.add(module.id);
    previous = module.id;
    let previousImportSource;
    array(module.imports, `${path}.imports`).forEach((item, itemIndex) => {
      validateImport(item, `${path}.imports[${itemIndex}]`);
      if (previousImportSource !== undefined && compareCodePoints(previousImportSource, item.source) >= 0) {
        fail(`${path}.imports[${itemIndex}].source`, 'imports must have unique code-point-sorted sources');
      }
      let previousBinding;
      for (const [bindingIndex, binding] of item.bindings.entries()) {
        const key = bindingKey(binding);
        if (previousBinding !== undefined && compareCodePoints(previousBinding, key) >= 0) {
          fail(`${path}.imports[${itemIndex}].bindings[${bindingIndex}]`, 'bindings must be strictly sorted');
        }
        previousBinding = key;
      }
      previousImportSource = item.source;
    });
    const exportNames = new Map();
    let previousExport;
    array(module.exports, `${path}.exports`).forEach((item, itemIndex) => {
      validateExport(item, `${path}.exports[${itemIndex}]`);
      if (exportNames.has(item.name)) fail(`${path}.exports[${itemIndex}].name`, `duplicate export ${item.name}`);
      if (previousExport !== undefined && compareCodePoints(previousExport, item.name) >= 0) {
        fail(`${path}.exports[${itemIndex}].name`, 'exports must be strictly code-point sorted');
      }
      exportNames.set(item.name, item.kind);
      previousExport = item.name;
    });
    exportsByModule.set(module.id, exportNames);
    importsByModule.set(module.id, module.imports);
    const declarations = new Map();
    array(module.nodes, `${path}.nodes`).forEach((item, itemIndex) => {
      validateNode(item, `${path}.nodes[${itemIndex}]`);
      if (item.kind !== 'fn') fail(`${path}.nodes[${itemIndex}].kind`, 'module root nodes must be fn');
      if (item.kind === 'fn') {
        const nameProperty = item.properties.find((entry) => entry.key === 'name');
        if (nameProperty === undefined) fail(`${path}.nodes[${itemIndex}].properties`, 'missing name property');
        const name = nameProperty.value.value;
        if (declarations.has(name)) fail(`${path}.nodes[${itemIndex}]`, `duplicate local declaration ${name}`);
        declarations.set(name, item.kind);
      }
    });
    declarationsByModule.set(module.id, declarations);
  }
  const graph = new Map();
  for (const module of value.modules) {
    const targets = [];
    const modulePath = `envelope.modules[${value.modules.indexOf(module)}]`;
    const declarations = declarationsByModule.get(module.id);
    if (declarations === undefined) fail(modulePath, `missing declarations for ${module.id}`);
    const moduleImports = importsByModule.get(module.id);
    if (moduleImports === undefined) fail(modulePath, `missing imports for ${module.id}`);
    const localNames = new Set(declarations.keys());
    for (const [importIndex, imported] of moduleImports.entries()) {
      const importPath = `envelope.modules[${value.modules.indexOf(module)}].imports[${importIndex}]`;
      if (!ids.has(imported.source)) fail(`${importPath}.source`, `missing module ${imported.source}`);
      targets.push(imported.source);
      const targetExports = exportsByModule.get(imported.source);
      if (targetExports === undefined) fail(`${importPath}.source`, `missing exports for ${imported.source}`);
      for (const [bindingIndex, binding] of imported.bindings.entries()) {
        if (!targetExports.has(binding.imported)) fail(`${importPath}.bindings[${bindingIndex}].imported`, `missing export ${binding.imported}`);
        const exportedKind = targetExports.get(binding.imported);
        if (binding.kind !== exportedKind) {
          fail(`${importPath}.bindings[${bindingIndex}].kind`, `expected ${exportedKind} for export ${binding.imported}`);
        }
        if (localNames.has(binding.local)) fail(`${importPath}.bindings[${bindingIndex}].local`, `duplicate local binding ${binding.local}`);
        localNames.add(binding.local);
      }
    }
    graph.set(module.id, targets);
    for (const [exportIndex, exported] of module.exports.entries()) {
      if (exported.source === null) {
        const declaredKind = declarationsByModule.get(module.id).get(exported.name);
        if (declaredKind === undefined) {
          fail(`envelope.modules[${value.modules.indexOf(module)}].exports[${exportIndex}]`, 'local export has no declaration');
        }
        if (declaredKind !== exported.kind) {
          fail(`envelope.modules[${value.modules.indexOf(module)}].exports[${exportIndex}].kind`, `local declaration has kind ${declaredKind}`);
        }
      } else {
        if (!ids.has(exported.source)) fail(`envelope.modules[${value.modules.indexOf(module)}].exports[${exportIndex}].source`, `missing module ${exported.source}`);
        const sourceImport = module.imports.find((imported) => imported.source === exported.source);
        if (sourceImport === undefined) {
          fail(`envelope.modules[${value.modules.indexOf(module)}].exports[${exportIndex}]`, 're-export source is not imported');
        }
        const reexportBinding = sourceImport.bindings.find((binding) => binding.local === exported.name && binding.reexport);
        if (reexportBinding === undefined) {
          fail(`envelope.modules[${value.modules.indexOf(module)}].exports[${exportIndex}]`, 're-export has no matching imported binding');
        }
        if (exported.kind !== reexportBinding.kind) {
          fail(`envelope.modules[${value.modules.indexOf(module)}].exports[${exportIndex}].kind`, `re-export binding has kind ${reexportBinding.kind}`);
        }
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail) => {
    if (visiting.has(id)) fail('envelope.modules', `module cycle: ${[...trail, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of graph.get(id)) visit(target, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...ids].sort(compareCodePoints)) visit(id, []);
  let previousDiagnostic;
  array(value.diagnostics, 'envelope.diagnostics').forEach((item, index) => {
    validateDiagnostic(item, `envelope.diagnostics[${index}]`);
    if (!ids.has(item.module)) fail(`envelope.diagnostics[${index}].module`, `missing module ${item.module}`);
    const key = diagnosticKey(item);
    if (previousDiagnostic !== undefined && compareCodePoints(previousDiagnostic, key) >= 0) {
      fail(`envelope.diagnostics[${index}]`, 'diagnostics must be strictly sorted');
    }
    previousDiagnostic = key;
  });
  return value;
}
