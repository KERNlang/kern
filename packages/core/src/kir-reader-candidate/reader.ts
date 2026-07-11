import {
  KIR_READER_CANDIDATE_FORMAT,
  type KirCandidateBinding,
  type KirCandidateDiagnostic,
  type KirCandidateEnvelope,
  type KirCandidateExport,
  type KirCandidateImport,
  type KirCandidateModule,
} from './types.js';
import {
  asArray,
  assertWellFormedText,
  compareCodePoints,
  exactKeys,
  fail,
  validateBoolean,
  validateIdentifier,
  validateLocation,
  validateNode,
} from './validation.js';

function validateBinding(value: unknown, path: string): KirCandidateBinding {
  const record = exactKeys(value, ['imported', 'local', 'kind', 'reexport'], path);
  const imported = validateIdentifier(record.imported, `${path}.imported`);
  const local = validateIdentifier(record.local, `${path}.local`);
  const kind = assertWellFormedText(record.kind, `${path}.kind`);
  if (kind !== 'fn') fail(`${path}.kind`, 'probe binding kind must be fn');
  return { imported, local, kind, reexport: validateBoolean(record.reexport, `${path}.reexport`) };
}

function validateImport(value: unknown, path: string): KirCandidateImport {
  const record = exactKeys(value, ['source', 'bindings'], path);
  const source = assertWellFormedText(record.source, `${path}.source`);
  const bindings = asArray(record.bindings, `${path}.bindings`).map((binding, index) =>
    validateBinding(binding, `${path}.bindings[${index}]`),
  );
  return { source, bindings };
}

function bindingKey(value: KirCandidateBinding): string {
  return [value.imported, value.local, value.kind, value.reexport ? '1' : '0'].join('\0');
}

function validateExport(value: unknown, path: string): KirCandidateExport {
  const record = exactKeys(value, ['name', 'kind', 'source'], path);
  const name = validateIdentifier(record.name, `${path}.name`);
  const kind = assertWellFormedText(record.kind, `${path}.kind`);
  if (kind !== 'fn') fail(`${path}.kind`, 'probe export kind must be fn');
  const source = record.source === null ? null : assertWellFormedText(record.source, `${path}.source`);
  return { name, kind, source };
}

function validateDiagnostic(value: unknown, path: string): KirCandidateDiagnostic {
  const record = exactKeys(value, ['module', 'code', 'severity', 'category', 'message', 'location'], path);
  const module = assertWellFormedText(record.module, `${path}.module`);
  const code = assertWellFormedText(record.code, `${path}.code`);
  const severity = assertWellFormedText(record.severity, `${path}.severity`);
  if (severity !== 'error' && severity !== 'warning' && severity !== 'info') {
    fail(`${path}.severity`, 'unknown severity');
  }
  return {
    module,
    code,
    severity,
    category: assertWellFormedText(record.category, `${path}.category`),
    message: assertWellFormedText(record.message, `${path}.message`),
    location: validateLocation(record.location, `${path}.location`),
  };
}

function diagnosticKey(value: KirCandidateDiagnostic): string {
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

function validateModule(value: unknown, path: string): KirCandidateModule {
  const record = exactKeys(value, ['id', 'imports', 'exports', 'nodes'], path);
  const id = assertWellFormedText(record.id, `${path}.id`);
  const segments = id.split('/');
  if (
    /^[A-Za-z]:/u.test(id) ||
    id.includes('\\') ||
    id.startsWith('/') ||
    id.endsWith('/') ||
    /[\u0000-\u001f\u007f]/u.test(id) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail(`${path}.id`, 'expected normalized relative POSIX id');
  }

  const imports = asArray(record.imports, `${path}.imports`).map((item, index) =>
    validateImport(item, `${path}.imports[${index}]`),
  );
  let previousImportSource: string | undefined;
  for (const [index, imported] of imports.entries()) {
    if (previousImportSource !== undefined && compareCodePoints(previousImportSource, imported.source) >= 0) {
      fail(`${path}.imports[${index}].source`, 'imports must have unique code-point-sorted sources');
    }
    let previousBinding: string | undefined;
    for (const [bindingIndex, binding] of imported.bindings.entries()) {
      const key = bindingKey(binding);
      if (previousBinding !== undefined && compareCodePoints(previousBinding, key) >= 0) {
        fail(`${path}.imports[${index}].bindings[${bindingIndex}]`, 'bindings must be strictly sorted');
      }
      previousBinding = key;
    }
    previousImportSource = imported.source;
  }

  const exports = asArray(record.exports, `${path}.exports`).map((item, index) =>
    validateExport(item, `${path}.exports[${index}]`),
  );
  const exportNames = new Set<string>();
  let previousExport: string | undefined;
  for (const [index, exported] of exports.entries()) {
    if (exportNames.has(exported.name)) fail(`${path}.exports[${index}].name`, `duplicate export ${exported.name}`);
    if (previousExport !== undefined && compareCodePoints(previousExport, exported.name) >= 0) {
      fail(`${path}.exports[${index}].name`, 'exports must be strictly code-point sorted');
    }
    exportNames.add(exported.name);
    previousExport = exported.name;
  }

  const nodes = asArray(record.nodes, `${path}.nodes`).map((item, index) =>
    validateNode(item, `${path}.nodes[${index}]`),
  );
  const declarations = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== 'fn') fail(`${path}.nodes[${index}].kind`, 'module root nodes must be fn');
    const name = node.properties.find((entry) => entry.key === 'name');
    if (name?.value.tag !== 'text') fail(`${path}.nodes[${index}]`, 'fn name must be text');
    if (declarations.has(name.value.value))
      fail(`${path}.nodes[${index}]`, `duplicate local declaration ${name.value.value}`);
    declarations.add(name.value.value);
  }
  return { id, imports, exports, nodes };
}

function moduleDeclarations(module: KirCandidateModule): Map<string, 'fn'> {
  const declarations = new Map<string, 'fn'>();
  for (const node of module.nodes) {
    if (node.kind !== 'fn') continue;
    const name = node.properties.find((entry) => entry.key === 'name');
    if (name?.value.tag === 'text') declarations.set(name.value.value, 'fn');
  }
  return declarations;
}

function validateGraph(modules: readonly KirCandidateModule[]): void {
  const ids = new Set(modules.map((module) => module.id));
  const exportsByModule = new Map(
    modules.map((module) => [module.id, new Map(module.exports.map((item) => [item.name, item.kind]))]),
  );
  const declarationsByModule = new Map(modules.map((module) => [module.id, moduleDeclarations(module)]));
  const graph = new Map<string, string[]>();

  for (const [moduleIndex, module] of modules.entries()) {
    const targets: string[] = [];
    const localNames = new Set(declarationsByModule.get(module.id)?.keys());
    for (const [importIndex, imported] of module.imports.entries()) {
      const importPath = `envelope.modules[${moduleIndex}].imports[${importIndex}]`;
      if (!ids.has(imported.source)) fail(`${importPath}.source`, `missing module ${imported.source}`);
      targets.push(imported.source);
      const targetExports = exportsByModule.get(imported.source);
      for (const [bindingIndex, binding] of imported.bindings.entries()) {
        const exportedKind = targetExports?.get(binding.imported);
        if (exportedKind === undefined)
          fail(`${importPath}.bindings[${bindingIndex}].imported`, `missing export ${binding.imported}`);
        if (binding.kind !== exportedKind) {
          fail(
            `${importPath}.bindings[${bindingIndex}].kind`,
            `expected ${exportedKind} for export ${binding.imported}`,
          );
        }
        if (localNames.has(binding.local))
          fail(`${importPath}.bindings[${bindingIndex}].local`, `duplicate local binding ${binding.local}`);
        localNames.add(binding.local);
      }
    }
    graph.set(module.id, targets);

    for (const [exportIndex, exported] of module.exports.entries()) {
      const exportPath = `envelope.modules[${moduleIndex}].exports[${exportIndex}]`;
      if (exported.source === null) {
        const declaredKind = declarationsByModule.get(module.id)?.get(exported.name);
        if (declaredKind === undefined) fail(exportPath, 'local export has no declaration');
        if (declaredKind !== exported.kind) fail(`${exportPath}.kind`, `local declaration has kind ${declaredKind}`);
        continue;
      }
      if (!ids.has(exported.source)) fail(`${exportPath}.source`, `missing module ${exported.source}`);
      const sourceImport = module.imports.find((item) => item.source === exported.source);
      if (!sourceImport) fail(exportPath, 're-export source is not imported');
      const binding = sourceImport.bindings.find((item) => item.local === exported.name && item.reexport);
      if (!binding) fail(exportPath, 're-export has no matching imported binding');
      if (exported.kind !== binding.kind) fail(`${exportPath}.kind`, `re-export binding has kind ${binding.kind}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trail: readonly string[]) => {
    if (visiting.has(id)) fail('envelope.modules', `module cycle: ${[...trail, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of graph.get(id) ?? []) visit(target, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...ids].sort(compareCodePoints)) visit(id, []);
}

export function validateKirReaderCandidate(value: unknown): KirCandidateEnvelope {
  const record = exactKeys(value, ['format', 'modules', 'diagnostics'], 'envelope');
  if (record.format !== KIR_READER_CANDIDATE_FORMAT) {
    fail('envelope.format', `unsupported format ${JSON.stringify(record.format)}`);
  }
  const modules = asArray(record.modules, 'envelope.modules').map((module, index) =>
    validateModule(module, `envelope.modules[${index}]`),
  );
  if (modules.length === 0) fail('envelope.modules', 'expected at least one module');
  const ids = new Set<string>();
  let previousModule: string | undefined;
  for (const [index, module] of modules.entries()) {
    if (ids.has(module.id)) fail(`envelope.modules[${index}].id`, 'duplicate module id');
    if (previousModule !== undefined && compareCodePoints(previousModule, module.id) >= 0) {
      fail(`envelope.modules[${index}].id`, 'modules must be strictly code-point sorted');
    }
    ids.add(module.id);
    previousModule = module.id;
  }
  validateGraph(modules);

  const diagnostics = asArray(record.diagnostics, 'envelope.diagnostics').map((item, index) =>
    validateDiagnostic(item, `envelope.diagnostics[${index}]`),
  );
  let previousDiagnostic: string | undefined;
  for (const [index, diagnostic] of diagnostics.entries()) {
    if (!ids.has(diagnostic.module))
      fail(`envelope.diagnostics[${index}].module`, `missing module ${diagnostic.module}`);
    const key = diagnosticKey(diagnostic);
    if (previousDiagnostic !== undefined && compareCodePoints(previousDiagnostic, key) >= 0) {
      fail(`envelope.diagnostics[${index}]`, 'diagnostics must be strictly sorted');
    }
    previousDiagnostic = key;
  }
  return { format: KIR_READER_CANDIDATE_FORMAT, modules, diagnostics };
}
