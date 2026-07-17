import { isPortableBindingName } from './ir/semantics/portable-scalar.js';
import { markRunnerMachineClassBinding, markRunnerMachineRootScope } from './ir/semantics/runner-machine-scope.js';
import type {
  RunnerClassBinding,
  RunnerClassFieldBinding,
  RunnerClassMemberBinding,
  RunnerFunctionBinding,
  RunnerModuleScope,
} from './ir/semantics/semantic-env.js';
import { KernRunnerError } from './runner-error.js';
import { moduleLinkErrors } from './runner-module-link.js';
import type { IRNode } from './types.js';

function topLevelNodes(root: IRNode): readonly IRNode[] {
  return root.type === 'document' ? (root.children ?? []) : [];
}

function isTrueProp(value: unknown): boolean {
  return value === true || value === 'true';
}

function singleKernHandler(node: IRNode): IRNode | undefined {
  const handlers = (node.children ?? []).filter((child) => child.type === 'handler' && child.props?.lang === 'kern');
  return handlers.length === 1 ? handlers[0] : undefined;
}

function runnerParamNames(node: IRNode, owner: string): readonly string[] {
  const paramChildren = (node.children ?? []).filter((child) => child.type === 'param');
  const legacyParams = typeof node.props?.params === 'string' ? node.props.params.trim() : '';
  if (paramChildren.length > 0 && legacyParams !== '') {
    throw new KernRunnerError(`runner function '${owner}' cannot mix params= with param children`);
  }
  const names =
    paramChildren.length > 0
      ? paramChildren.map((param) => {
          const name = param.props?.name;
          if (!isPortableBindingName(name)) {
            throw new KernRunnerError(`runner function '${owner}' param must be a portable identifier`);
          }
          if ((param.children ?? []).length > 0) {
            throw new KernRunnerError(`runner function '${owner}' destructured params are unsupported`);
          }
          for (const unsupported of ['value', 'default'] as const) {
            if (param.props?.[unsupported] !== undefined) {
              throw new KernRunnerError(`runner function '${owner}' param ${unsupported}= is unsupported`);
            }
          }
          for (const unsupported of ['optional', 'variadic'] as const) {
            if (isTrueProp(param.props?.[unsupported])) {
              throw new KernRunnerError(`runner function '${owner}' param ${unsupported}= is unsupported`);
            }
          }
          return name;
        })
      : legacyParamNames(legacyParams, owner);
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new KernRunnerError(`runner function '${owner}' has duplicate param '${name}'`);
    seen.add(name);
  }
  return names;
}

function legacyParamNames(params: string, owner: string): string[] {
  if (params === '') return [];
  return params.split(',').map((part) => {
    const trimmed = part.trim();
    if (trimmed === '' || trimmed.includes('=') || trimmed.startsWith('...') || trimmed.includes('?')) {
      throw new KernRunnerError(`runner function '${owner}' has unsupported params= syntax`);
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[A-Za-z_][A-Za-z0-9_]*(?:\[\])?)?$/.exec(trimmed);
    if (!match || !isPortableBindingName(match[1])) {
      throw new KernRunnerError(`runner function '${owner}' has unsupported params= syntax`);
    }
    return match[1];
  });
}

function runnerClassMemberBinding(
  node: IRNode,
  ownerClass: string,
  fallbackName: string,
): RunnerClassMemberBinding | undefined {
  const name = node.type === 'constructor' ? fallbackName : node.props?.name;
  if (!isPortableBindingName(name)) return undefined;
  if (isTrueProp(node.props?.async) || isTrueProp(node.props?.stream) || isTrueProp(node.props?.static)) {
    throw new KernRunnerError(
      `runner class '${ownerClass}' member '${name}' uses unsupported async, stream, or static`,
    );
  }
  const handler = singleKernHandler(node);
  if (!handler) {
    throw new KernRunnerError(
      `runner class '${ownerClass}' member '${name}' must contain exactly one handler lang="kern"`,
    );
  }
  return {
    name,
    params: runnerParamNames(node, `${ownerClass}.${name}`),
    handler,
    body: handler.children ?? [],
    ownerClass,
  };
}

function runnerClassBinding(node: IRNode): RunnerClassBinding | undefined {
  const name = node.props?.name;
  if (!isPortableBindingName(name)) return undefined;
  const fields: RunnerClassFieldBinding[] = [];
  const fieldNames = new Set<string>();
  const methods = new Map<string, RunnerClassMemberBinding>();
  const getters = new Map<string, RunnerClassMemberBinding>();
  let constructorBinding: RunnerClassMemberBinding | undefined;
  for (const child of node.children ?? []) {
    if (child.type === 'field') {
      const fieldName = child.props?.name;
      if (!isPortableBindingName(fieldName)) continue;
      if (fieldNames.has(fieldName)) {
        throw new KernRunnerError(`runner class '${name}' has duplicate field '${fieldName}'`);
      }
      fieldNames.add(fieldName);
      fields.push({ name: fieldName, value: child.props?.value });
      continue;
    }
    if (child.type === 'constructor') {
      if (constructorBinding) throw new KernRunnerError(`runner class '${name}' has duplicate constructors`);
      constructorBinding = runnerClassMemberBinding(child, name, 'constructor');
      continue;
    }
    if (child.type !== 'method' && child.type !== 'getter') continue;
    const member = runnerClassMemberBinding(child, name, child.type);
    const members = child.type === 'method' ? methods : getters;
    if (member && members.has(member.name)) {
      throw new KernRunnerError(`runner class '${name}' has duplicate ${child.type} '${member.name}'`);
    }
    if (member) members.set(member.name, member);
  }
  const extendsName =
    typeof node.props?.extends === 'string' && node.props.extends !== '' ? node.props.extends : undefined;
  return { name, extendsName, fields, constructor: constructorBinding, methods, getters };
}

function runnerFunctionBinding(node: IRNode): RunnerFunctionBinding | undefined {
  const name = node.props?.name;
  if (!isPortableBindingName(name)) return undefined;
  if (isTrueProp(node.props?.async) || isTrueProp(node.props?.stream)) return undefined;
  if (node.props?.returns === undefined || node.props.returns === '' || node.props.returns === 'void') return undefined;
  const handler = singleKernHandler(node);
  if (!handler) return undefined;
  try {
    return {
      name,
      params: runnerParamNames(node, name),
      returns: node.props.returns,
      handler,
      body: handler.children ?? [],
    };
  } catch (error) {
    if (error instanceof KernRunnerError) return undefined;
    throw error;
  }
}

export function collectRunnerFunctions(root: IRNode): Map<string, RunnerFunctionBinding> {
  const functions = new Map<string, RunnerFunctionBinding>();
  for (const node of topLevelNodes(root)) {
    if (node.type !== 'fn' || node.props?.name === 'main') continue;
    const binding = runnerFunctionBinding(node);
    if (!binding) continue;
    if (functions.has(binding.name)) throw new KernRunnerError(`duplicate runner function '${binding.name}'`);
    functions.set(binding.name, binding);
  }
  return functions;
}

export function assertRunnerClassAcyclic(classes: ReadonlyMap<string, RunnerClassBinding>): void {
  for (const cls of classes.values()) {
    const seen = new Set<string>();
    for (let current: string | undefined = cls.name; current; ) {
      if (seen.has(current)) throw new KernRunnerError(`runner class '${cls.name}' has cyclic inheritance`);
      seen.add(current);
      current = classes.get(current)?.extendsName;
    }
  }
}

export function collectRunnerClasses(root: IRNode): Map<string, RunnerClassBinding> {
  const classes = new Map<string, RunnerClassBinding>();
  for (const node of topLevelNodes(root)) {
    if (node.type !== 'class') continue;
    const binding = runnerClassBinding(node);
    if (!binding) continue;
    if (classes.has(binding.name)) throw new KernRunnerError(`duplicate runner class '${binding.name}'`);
    classes.set(binding.name, binding);
  }
  for (const cls of classes.values()) {
    if (cls.extendsName && !classes.has(cls.extendsName)) {
      throw new KernRunnerError(`runner class '${cls.name}' extends unknown class '${cls.extendsName}'`);
    }
  }
  assertRunnerClassAcyclic(classes);
  return classes;
}

export function validateRunnerCallableNames(
  functions: ReadonlyMap<string, RunnerFunctionBinding>,
  classes: ReadonlyMap<string, RunnerClassBinding>,
): void {
  if (classes.has('main')) throw new KernRunnerError("runner class 'main' conflicts with the native entrypoint");
  for (const name of classes.keys()) {
    if (functions.has(name)) {
      throw new KernRunnerError(`runner class '${name}' conflicts with runner function '${name}'`);
    }
  }
}

export interface RunnerLinkedScopeExport {
  readonly kind: 'class' | 'fn';
  readonly sourceName: string;
}

export interface RunnerLinkedScopeImport {
  readonly exportOnly: boolean;
  readonly importedName: string;
  readonly localName: string;
  readonly targetPath: string;
}

export interface RunnerLinkedScopeRecord {
  readonly classes: ReadonlyMap<string, RunnerClassBinding>;
  readonly exports: ReadonlyMap<string, RunnerLinkedScopeExport>;
  readonly functions: ReadonlyMap<string, RunnerFunctionBinding>;
  readonly imports: readonly RunnerLinkedScopeImport[];
  readonly path: string;
}

/** Build one identity-preserving runtime scope per already-validated linked module. */
export function buildRunnerModuleScopes(records: readonly RunnerLinkedScopeRecord[]): Map<string, RunnerModuleScope> {
  const byPath = new Map(records.map((record) => [record.path, record]));
  const scopes = new Map<string, RunnerModuleScope>();
  for (const record of records) {
    const scope: RunnerModuleScope = { functions: new Map(), classes: new Map() };
    for (const [name, binding] of record.functions) scope.functions.set(name, { ...binding, module: scope });
    for (const [name, binding] of record.classes) {
      const scopedBinding = { ...binding, module: scope };
      markRunnerMachineClassBinding(scopedBinding);
      scope.classes.set(name, scopedBinding);
    }
    scopes.set(record.path, scope);
  }

  const resolveExport = (
    path: string,
    name: string,
    seen: Set<string>,
  ): { readonly kind: 'class' | 'fn'; readonly binding: RunnerClassBinding | RunnerFunctionBinding } | undefined => {
    const key = `${path}\u0000${name}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const record = byPath.get(path);
    const scope = scopes.get(path);
    if (!record || !scope) return undefined;
    // Additive re-exports are import edges, so follow them before consulting
    // own exports. Own exports always name declarations allocated in pass one;
    // they never depend on another module's pass-two import wiring.
    const reexport = record.imports.find((imported) => imported.exportOnly && imported.localName === name);
    if (reexport) return resolveExport(reexport.targetPath, reexport.importedName, seen);
    const exported = record.exports.get(name);
    if (exported?.kind === 'fn') {
      const binding = scope.functions.get(exported.sourceName);
      if (binding) return { binding, kind: 'fn' };
    } else if (exported?.kind === 'class') {
      const binding = scope.classes.get(exported.sourceName);
      if (binding) return { binding, kind: 'class' };
    }
    return undefined;
  };

  for (const record of records) {
    const scope = scopes.get(record.path);
    if (!scope) continue;
    for (const imported of record.imports) {
      const resolved = resolveExport(imported.targetPath, imported.importedName, new Set());
      if (!resolved) {
        throw new KernRunnerError(
          moduleLinkErrors.doesNotExport(imported.targetPath, imported.importedName, record.path),
        );
      }
      if (scope.functions.has(imported.localName) || scope.classes.has(imported.localName)) {
        throw new KernRunnerError(moduleLinkErrors.aliasConflicts(imported.localName, record.path));
      }
      if (resolved.kind === 'fn') scope.functions.set(imported.localName, resolved.binding as RunnerFunctionBinding);
      else scope.classes.set(imported.localName, resolved.binding as RunnerClassBinding);
    }
    validateRunnerCallableNames(scope.functions, scope.classes);
    assertRunnerClassAcyclic(scope.classes);
  }
  return scopes;
}

export function buildSingleModuleRunnerRootScope(root: IRNode): RunnerModuleScope {
  const rawFunctions = collectRunnerFunctions(root);
  const rawClasses = collectRunnerClasses(root);
  validateRunnerCallableNames(rawFunctions, rawClasses);
  const scope: RunnerModuleScope = { functions: new Map(), classes: new Map() };
  for (const [name, binding] of rawFunctions) scope.functions.set(name, { ...binding, module: scope });
  for (const [name, binding] of rawClasses) {
    const scopedBinding = { ...binding, module: scope };
    markRunnerMachineClassBinding(scopedBinding);
    scope.classes.set(name, scopedBinding);
  }
  markRunnerMachineRootScope(scope);
  return scope;
}
