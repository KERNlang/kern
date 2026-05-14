/**
 * Module Generators — import.
 *
 * NOTE: generateModule remains in codegen-core.ts because it calls
 * generateCoreNode recursively for inline child definitions.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import { parseExternalSignatureMap } from '../ecosystem-signatures.js';
import { type SidecarManifest, sidecarManifestFromNode } from '../external-boundary.js';
import { parseExternalNamedBinding, signatureMapForSidecarPackage } from '../external-symbols.js';
import {
  importRegistryOf,
  importTargetFamilyOf,
  importTargetOf,
  shouldEmitImportForTarget,
  splitCapabilityList,
} from '../import-metadata.js';
import { propsOf } from '../node-props.js';
import { pythonSidecarNameFromAliasAndPackage } from '../python-sidecar.js';
import type { IRNode } from '../types.js';
import { emitIdentifier, emitImportSpecifier } from './emitters.js';
import { generateFunction } from './functions.js';
import { getChildren, getProps } from './helpers.js';

const _p = getProps;
const kids = getChildren;

// ── Import ──────────────────────────────────────────────────────────────

function emitImportBinding(raw: string, node: IRNode): string {
  const match = raw.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u);
  if (!match) return emitIdentifier(raw.trim(), 'import', node);
  const source = emitIdentifier(match[1], 'import', node);
  const alias = match[2] ? emitIdentifier(match[2], 'import alias', node) : '';
  return alias ? `${source} as ${alias}` : source;
}

interface GenerateImportOptions {
  pythonSidecar?: boolean;
}

export function generateImport(node: IRNode, options: GenerateImportOptions = {}): string[] {
  const props = propsOf<'import'>(node);
  const from = props.from;
  const names = props.names;
  const defaultImport = props.default;
  const isTypeOnly = props.types === 'true' || props.types === true;

  if (!from) return [];
  if (options.pythonSidecar !== false && !isTypeOnly && isPythonPackageImport(props)) {
    return generateLoosePythonSidecarImport(node);
  }
  if (!shouldEmitImportForTarget(props, 'ts')) return [];

  const safePath = emitImportSpecifier(from, node);
  const typeKw = isTypeOnly ? 'type ' : '';
  const safeDefault = defaultImport ? emitIdentifier(defaultImport, 'default', node) : '';
  const namedList = names
    ? names
        .split(',')
        .map((s) => emitImportBinding(s, node))
        .join(', ')
    : '';

  if (safeDefault && namedList) {
    return [`import ${typeKw}${safeDefault}, { ${namedList} } from '${safePath}';`];
  }
  if (safeDefault) {
    return [`import ${typeKw}${safeDefault} from '${safePath}';`];
  }
  if (namedList) {
    return [`import ${typeKw}{ ${namedList} } from '${safePath}';`];
  }
  // Side-effect import
  return [`import '${safePath}';`];
}

function externChildImport(node: IRNode, child?: IRNode): IRNode {
  const props = propsOf<'extern'>(node);
  const packageName = props.package;
  const childProps = child?.props ?? {};
  return {
    type: 'import',
    props: {
      ...(child
        ? childProps
        : {
            names: props.names,
            default: props.default,
            types: props.types,
          }),
      registry: props.registry,
      target: props.target,
      package: packageName,
      from: childProps.from ?? packageName,
    },
    children: child?.children ?? [],
    loc: child?.loc ?? node.loc,
  };
}

export function generateExtern(node: IRNode): string[] {
  const children = kids(node, 'import');
  const props = propsOf<'extern'>(node);
  const hasInlineBinding = Boolean(props.names || props.default);
  const inlineImport = hasInlineBinding ? generateImport(externChildImport(node), { pythonSidecar: false }) : [];
  const childImports = children.flatMap((child) =>
    generateImport(externChildImport(node, child), { pythonSidecar: false }),
  );
  return [...new Set([...inlineImport, ...childImports])];
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0].toLowerCase()}${value.slice(1)}`;
}

function upperFirst(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function emitStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

const SAFE_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

function emitObjectTypeKey(name: string): string {
  return SAFE_IDENTIFIER_RE.test(name) ? name : JSON.stringify(name);
}

function uniqueGeneratedName(base: string, used: Set<string>): string {
  let name = base;
  let suffix = 2;
  while (used.has(name)) {
    name = `${base}${suffix}`;
    suffix++;
  }
  used.add(name);
  return name;
}

function isPythonPackageImport(props: { package?: unknown; registry?: unknown; target?: unknown }): boolean {
  const hasExplicitPackage = typeof props.package === 'string' && props.package.length > 0;
  return (
    hasExplicitPackage &&
    (importRegistryOf(props.registry) === 'pypi' || importTargetFamilyOf(props.target, props.registry) === 'python')
  );
}

export function isLoosePythonSidecarImportNode(node: IRNode): boolean {
  if (node.type !== 'import') return false;
  const props = propsOf<'import'>(node);
  const isTypeOnly = props.types === 'true' || props.types === true;
  return !isTypeOnly && isPythonPackageImport(props);
}

function loosePythonSidecarName(node: IRNode): string {
  const props = getProps(node);
  const alias = typeof props.default === 'string' && props.default.length > 0 ? props.default : '';
  const rawFrom =
    typeof props.package === 'string' && props.package.length > 0 ? props.package : String(props.from ?? '');
  return pythonSidecarNameFromAliasAndPackage(alias || undefined, rawFrom);
}

function sidecarPackageFromImportNode(node: IRNode): SidecarManifest['packages'][number] | null {
  const props = getProps(node);
  const packageName =
    typeof props.package === 'string' && props.package.length > 0
      ? props.package
      : typeof props.from === 'string' && props.from.length > 0
        ? props.from
        : '';
  if (!packageName) return null;

  const sidecarPackage = {
    package: packageName,
    registry: importRegistryOf(props.registry),
    target: importTargetOf(props.target, props.registry),
    targetFamily: importTargetFamilyOf(props.target, props.registry),
    imports: [
      {
        names: splitCapabilityList(props.names),
        default: typeof props.default === 'string' && props.default.length > 0 ? props.default : undefined,
        from: typeof props.from === 'string' && props.from.length > 0 ? props.from : undefined,
        signature: typeof props.signature === 'string' && props.signature.length > 0 ? props.signature : undefined,
        signatures: parseExternalSignatureMap(props.signatures),
        types: false,
        line: node.loc?.line,
        col: node.loc?.col,
      },
    ],
    ...(typeof props.version === 'string' && props.version.length > 0 ? { version: props.version } : {}),
    ...(node.loc?.line !== undefined ? { line: node.loc.line } : {}),
    ...(node.loc?.col !== undefined ? { col: node.loc.col } : {}),
  };
  return sidecarPackage;
}

function generateLoosePythonSidecarImport(node: IRNode): string[] {
  return generateLoosePythonSidecarImports([node]);
}

export function generateLoosePythonSidecarImports(nodes: IRNode[]): string[] {
  const groups = new Map<string, { manifest: SidecarManifest; node: IRNode }>();
  for (const node of nodes) {
    if (!isLoosePythonSidecarImportNode(node)) continue;
    const props = getProps(node);
    const sidecarPackage = sidecarPackageFromImportNode(node);
    if (!sidecarPackage) continue;
    const name = loosePythonSidecarName(node);
    const current = groups.get(name);
    if (!current) {
      groups.set(name, {
        node,
        manifest: {
          name,
          kind: 'sidecar',
          runtime: 'python',
          effects: splitCapabilityList(props.effects),
          serialization:
            typeof props.serialization === 'string' && props.serialization.length > 0 ? props.serialization : 'json',
          requiresSidecar: true,
          packages: [sidecarPackage],
          ...(node.loc?.line !== undefined ? { line: node.loc.line } : {}),
          ...(node.loc?.col !== undefined ? { col: node.loc.col } : {}),
        },
      });
      continue;
    }
    current.manifest.effects = [...new Set([...current.manifest.effects, ...splitCapabilityList(props.effects)])];
    const packageKey = `${sidecarPackage.package}\0${sidecarPackage.registry}\0${sidecarPackage.target}`;
    const existing = current.manifest.packages.find(
      (pkg) => `${pkg.package}\0${pkg.registry}\0${pkg.target}` === packageKey,
    );
    if (existing) {
      existing.imports.push(...sidecarPackage.imports);
      if (!existing.version && sidecarPackage.version) existing.version = sidecarPackage.version;
    } else {
      current.manifest.packages.push(sidecarPackage);
    }
  }
  return [...groups.values()].flatMap((group) => generatePythonSidecarClient(group.manifest, group.node));
}

const PYTHON_SIDECAR_RUNTIME = [
  'import base64',
  'import collections.abc',
  'import importlib',
  'import contextlib',
  'import json',
  'import sys',
  'import traceback',
  '',
  '_modules = {}',
  '',
  'def _resolve(module_name, method_name):',
  '    module = _modules.get(module_name)',
  '    if module is None:',
  '        module = importlib.import_module(module_name)',
  '        _modules[module_name] = module',
  '    target = module',
  '    for part in method_name.split("."):',
  '        target = getattr(target, part)',
  '    return target',
  '',
  'def _encode(value):',
  '    if isinstance(value, (bytes, bytearray, memoryview)):',
  '        return {"__kern_bytes__": base64.b64encode(bytes(value)).decode("ascii")}',
  '    if isinstance(value, tuple):',
  '        return [_encode(item) for item in value]',
  '    if isinstance(value, list):',
  '        return [_encode(item) for item in value]',
  '    if isinstance(value, dict):',
  '        return {str(key): _encode(item) for key, item in value.items()}',
  '    return value',
  '',
  'def _decode(value):',
  '    if isinstance(value, dict):',
  '        encoded = value.get("__kern_bytes__")',
  '        if isinstance(encoded, str):',
  '            return base64.b64decode(encoded.encode("ascii"))',
  '        return {key: _decode(item) for key, item in value.items()}',
  '    if isinstance(value, list):',
  '        return [_decode(item) for item in value]',
  '    return value',
  '',
  'def _is_streamable(value):',
  '    if isinstance(value, (str, bytes, bytearray, memoryview, dict)):',
  '        return False',
  '    return isinstance(value, collections.abc.Iterable)',
  '',
  'def _send(response):',
  '    print(json.dumps(response), flush=True)',
  '',
  'for line in sys.stdin:',
  '    request = {}',
  '    try:',
  '        request = json.loads(line)',
  '        target = _resolve(request["module"], request["method"])',
  '        args = _decode(request.get("args") or [])',
  '        kwargs = _decode(request.get("kwargs") or {})',
  '        if not isinstance(args, list):',
  '            raise TypeError("args must be a list")',
  '        if not isinstance(kwargs, dict):',
  '            raise TypeError("kwargs must be an object")',
  '        with contextlib.redirect_stdout(sys.stderr):',
  '            result = target(*args, **kwargs)',
  '        if request.get("stream") is True and _is_streamable(result):',
  '            iterator = iter(result)',
  '            while True:',
  '                try:',
  '                    with contextlib.redirect_stdout(sys.stderr):',
  '                        item = next(iterator)',
  '                except StopIteration:',
  '                    break',
  '                _send({"id": request.get("id"), "ok": True, "stream": True, "done": False, "chunk": _encode(item)})',
  '            response = {"id": request.get("id"), "ok": True, "stream": True, "done": True}',
  '        else:',
  '            response = {"id": request.get("id"), "ok": True, "result": _encode(result)}',
  '    except Exception as exc:',
  '        response = {',
  '            "id": request.get("id"),',
  '            "ok": False,',
  '            "error": {',
  '                "type": type(exc).__name__,',
  '                "message": str(exc),',
  '                "traceback": traceback.format_exc(),',
  '            },',
  '        }',
  '    try:',
  '        _send(response)',
  '    except Exception as exc:',
  '        fallback = {',
  '            "id": response.get("id"),',
  '            "ok": False,',
  '            "error": {',
  '                "type": type(exc).__name__,',
  '                "message": str(exc),',
  '                "traceback": traceback.format_exc(),',
  '            },',
  '        }',
  '        print(json.dumps(fallback), flush=True)',
].join('\n');

function generatePythonSidecarClient(manifest: SidecarManifest, node: IRNode): string[] {
  const baseName = emitIdentifier(lowerFirst(manifest.name), 'pythonSidecar', node);
  const manifestName = emitIdentifier(`${baseName}SidecarManifest`, 'pythonSidecarManifest', node);
  const clientName = emitIdentifier(`${baseName}SidecarClient`, 'pythonSidecarClient', node);
  const runtimeName = emitIdentifier(`${baseName}PythonSidecarRuntime`, 'pythonSidecarRuntime', node);
  const factoryName = emitIdentifier(
    `create${baseName[0].toUpperCase()}${baseName.slice(1)}SidecarClient`,
    'createSidecarClient',
    node,
  );
  const packageNames = manifest.packages.map((sidecarPackage) => sidecarPackage.package);
  const lines = [`export const ${manifestName} = {`, `  name: ${JSON.stringify(manifest.name)},`];
  if (manifest.kind) lines.push(`  kind: ${JSON.stringify(manifest.kind)},`);
  lines.push(
    `  runtime: ${JSON.stringify(manifest.runtime)},`,
    `  packages: ${emitStringArray(packageNames)},`,
    `  effects: ${emitStringArray(manifest.effects)},`,
  );
  if (manifest.serialization) lines.push(`  serialization: ${JSON.stringify(manifest.serialization)},`);
  lines.push(
    '  requiresSidecar: true,',
    '} as const;',
    '',
    `const ${runtimeName} = ${JSON.stringify(PYTHON_SIDECAR_RUNTIME)};`,
    '',
    `function ${factoryName}(manifest: typeof ${manifestName}) {`,
    '  type CallPayload = { args?: unknown[]; kwargs?: Record<string, unknown> };',
    '  type StreamController = { push: (value: unknown) => void; finish: () => void; fail: (error: unknown) => void };',
    '  type Pending = { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; stream?: StreamController };',
    '  type PythonFunction = ((...args: unknown[]) => Promise<unknown>) & { kwargs: (kwargs: Record<string, unknown>, ...args: unknown[]) => Promise<unknown> };',
    '  type PythonModule = Record<string, PythonFunction>;',
    "  let proc: import('node:child_process').ChildProcessWithoutNullStreams | null = null;",
    '  let starting: Promise<void> | null = null;',
    '  let nextId = 1;',
    '  let stderr = "";',
    '  const pending = new Map<number, Pending>();',
    '  const allowedModules = new Set<string>(manifest.packages);',
    '',
    '  function rejectPending(error: Error): void {',
    '    for (const waiter of pending.values()) waiter.reject(error);',
    '    pending.clear();',
    '  }',
    '',
    '  function encodePythonValue(value: unknown): unknown {',
    "    if (value instanceof Uint8Array) return { __kern_bytes__: Buffer.from(value).toString('base64') };",
    '    if (value instanceof ArrayBuffer) return { __kern_bytes__: Buffer.from(value).toString("base64") };',
    '    if (Array.isArray(value)) return value.map((item) => encodePythonValue(item));',
    "    if (value && typeof value === 'object') {",
    '      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodePythonValue(item)]));',
    '    }',
    '    return value;',
    '  }',
    '',
    '  function decodePythonValue(value: unknown): unknown {',
    '    if (Array.isArray(value)) return value.map((item) => decodePythonValue(item));',
    "    if (value && typeof value === 'object') {",
    '      const record = value as Record<string, unknown>;',
    "      if (typeof record.__kern_bytes__ === 'string') return Uint8Array.from(Buffer.from(record.__kern_bytes__, 'base64'));",
    '      return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decodePythonValue(item)]));',
    '    }',
    '    return value;',
    '  }',
    '',
    '  async function start(): Promise<void> {',
    '    if (proc) return;',
    '    if (starting) return starting;',
    '    starting = (async () => {',
    "      const [{ spawn }, { createInterface }] = await Promise.all([import('node:child_process'), import('node:readline')]);",
    "      const python = process.env.KERN_PYTHON || process.env.PYTHON || 'python3';",
    '      stderr = "";',
    `      const child = spawn(python, ['-u', '-c', ${runtimeName}], { stdio: ['pipe', 'pipe', 'pipe'] });`,
    '      proc = child;',
    '      const fail = (error: Error) => {',
    '        if (proc !== child) return;',
    '        rejectPending(error);',
    '        proc = null;',
    '      };',
    "      child.stderr.on('data', (chunk) => {",
    '        stderr += String(chunk);',
    '        if (stderr.length > 8192) stderr = stderr.slice(-8192);',
    '      });',
    "      child.stdin.on('error', fail);",
    "      child.stdout.on('error', fail);",
    '      const reader = createInterface({ input: child.stdout });',
    "      reader.on('line', (line) => {",
    '        let message: { id?: number; ok?: boolean; result?: unknown; chunk?: unknown; stream?: boolean; done?: boolean; error?: { type?: string; message?: string; traceback?: string } };',
    '        try {',
    '          message = JSON.parse(line) as typeof message;',
    '        } catch {',
    '          return;',
    '        }',
    "        if (typeof message.id !== 'number') return;",
    '        const waiter = pending.get(message.id);',
    '        if (!waiter) return;',
    '        if (message.stream && waiter.stream) {',
    '          if (message.ok && message.done) {',
    '            waiter.stream.finish();',
    '            pending.delete(message.id);',
    '          } else if (message.ok) {',
    '            waiter.stream.push(decodePythonValue(message.chunk));',
    '          } else {',
    "            const error = new Error(message.error?.message || 'Python sidecar stream failed');",
    '            Object.assign(error, { pythonType: message.error?.type, pythonTraceback: message.error?.traceback });',
    '            waiter.reject(error);',
    '            pending.delete(message.id);',
    '          }',
    '        } else if (message.ok && waiter.stream) {',
    '          waiter.stream.push(decodePythonValue(message.result));',
    '          waiter.stream.finish();',
    '          pending.delete(message.id);',
    '        } else if (message.ok) {',
    '          pending.delete(message.id);',
    '          waiter.resolve(decodePythonValue(message.result));',
    '        } else {',
    '          pending.delete(message.id);',
    "          const error = new Error(message.error?.message || 'Python sidecar call failed');",
    '          Object.assign(error, { pythonType: message.error?.type, pythonTraceback: message.error?.traceback });',
    '          waiter.reject(error);',
    '        }',
    '      });',
    "      reader.on('close', () => {",
    '        fail(new Error(`Python sidecar ${manifest.name} stdout closed${stderr ? `: ${stderr}` : ""}`));',
    '      });',
    "      child.on('error', fail);",
    "      child.on('exit', (code, signal) => {",
    '        if (proc !== child) return;',
    '        const error = new Error(`Python sidecar ${manifest.name} exited (${signal ?? code ?? "unknown"})${stderr ? `: ${stderr}` : ""}`);',
    '        rejectPending(error);',
    '        proc = null;',
    '      });',
    '    })().finally(() => {',
    '      starting = null;',
    '    });',
    '    return starting;',
    '  }',
    '',
    '  const client = {',
    '    manifest,',
    '    module(moduleName: string): PythonModule {',
    '      if (!allowedModules.has(moduleName)) {',
    "        throw new Error(`Python module '${moduleName}' is not declared in sidecar island '${manifest.name}'`);",
    '      }',
    '      return new Proxy({}, {',
    '        get: (_target, prop) => {',
    "          if (typeof prop !== 'string' || prop === 'then') return undefined;",
    '          return client.bind(moduleName, prop);',
    '        },',
    '      }) as PythonModule;',
    '    },',
    '    bind(moduleName: string, method: string): PythonFunction {',
    '      const fn = ((...args: unknown[]) => client.call(moduleName, method, { args })) as PythonFunction;',
    '      fn.kwargs = (kwargs: Record<string, unknown>, ...args: unknown[]) => client.call(moduleName, method, { args, kwargs });',
    '      return fn;',
    '    },',
    '    async call(moduleName: string, method: string, payload: CallPayload = {}): Promise<unknown> {',
    '      if (!allowedModules.has(moduleName)) {',
    "        throw new Error(`Python module '${moduleName}' is not declared in sidecar island '${manifest.name}'`);",
    '      }',
    '      await start();',
    '      const active = proc;',
    "      if (!active || !active.stdin.writable) throw new Error(`Python sidecar '${manifest.name}' is not writable`);",
    '      const id = nextId++;',
    '      const request = { id, module: moduleName, method, args: encodePythonValue(payload.args ?? []), kwargs: encodePythonValue(payload.kwargs ?? {}) };',
    '      return new Promise((resolve, reject) => {',
    '        pending.set(id, { resolve, reject });',
    '        active.stdin.write(`${JSON.stringify(request)}\\n`, (err) => {',
    '          if (!err) return;',
    '          pending.delete(id);',
    '          reject(err);',
    '        });',
    '      });',
    '    },',
    '    async *stream(moduleName: string, method: string, payload: CallPayload = {}): AsyncGenerator<unknown> {',
    '      if (!allowedModules.has(moduleName)) {',
    "        throw new Error(`Python module '${moduleName}' is not declared in sidecar island '${manifest.name}'`);",
    '      }',
    '      await start();',
    '      const active = proc;',
    "      if (!active || !active.stdin.writable) throw new Error(`Python sidecar '${manifest.name}' is not writable`);",
    '      const id = nextId++;',
    '      const queue: unknown[] = [];',
    '      const waiters: Array<{ resolve: (result: IteratorResult<unknown>) => void; reject: (error: unknown) => void }> = [];',
    '      let finished = false;',
    '      let failed: unknown;',
    '      const nextChunk = () => new Promise<IteratorResult<unknown>>((resolve, reject) => {',
    '        if (failed) { reject(failed); return; }',
    '        if (queue.length > 0) { resolve({ value: queue.shift(), done: false }); return; }',
    '        if (finished) { resolve({ value: undefined, done: true }); return; }',
    '        waiters.push({ resolve, reject });',
    '      });',
    '      const stream: StreamController = {',
    '        push(value) {',
    '          const waiter = waiters.shift();',
    '          if (waiter) waiter.resolve({ value, done: false });',
    '          else queue.push(value);',
    '        },',
    '        finish() {',
    '          finished = true;',
    '          for (const waiter of waiters.splice(0)) waiter.resolve({ value: undefined, done: true });',
    '        },',
    '        fail(error) {',
    '          failed = error;',
    '          for (const waiter of waiters.splice(0)) waiter.reject(error);',
    '        },',
    '      };',
    '      const reject = (error: unknown) => {',
    '        stream.fail(error);',
    '      };',
    '      pending.set(id, { resolve: stream.finish, reject, stream });',
    '      const request = { id, module: moduleName, method, args: encodePythonValue(payload.args ?? []), kwargs: encodePythonValue(payload.kwargs ?? {}), stream: true };',
    '      active.stdin.write(`${JSON.stringify(request)}\\n`, (err) => {',
    '        if (!err) return;',
    '        pending.delete(id);',
    '        reject(err);',
    '      });',
    '      try {',
    '        while (true) {',
    '          const item = await nextChunk();',
    '          if (item.done) break;',
    '          yield item.value;',
    '        }',
    '      } finally {',
    '        pending.delete(id);',
    '      }',
    '    },',
    '    close(): void {',
    '      const active = proc;',
    '      if (!active) return;',
    '      proc = null;',
    "      rejectPending(new Error(`Python sidecar '${manifest.name}' closed`));",
    '      active.kill();',
    '    },',
    '    dispose(): void {',
    '      client.close();',
    '    },',
    '  } as const;',
    '  return client;',
    '}',
    '',
    `export const ${clientName} = ${factoryName}(${manifestName});`,
  );
  const usedExportNames = new Set([manifestName, clientName, runtimeName, factoryName]);
  const usedTypeNames = new Set<string>();
  const callableTypeName = uniqueGeneratedName(
    emitIdentifier(`${upperFirst(baseName)}PythonCallable`, 'pythonCallableType', node),
    usedTypeNames,
  );
  let emittedCallableType = false;
  for (const sidecarPackage of manifest.packages) {
    const moduleAliases = new Set<string>();
    for (const binding of sidecarPackage.imports) {
      if (binding.default) moduleAliases.add(binding.default);
    }
    if (moduleAliases.size === 0 && SAFE_IDENTIFIER_RE.test(sidecarPackage.package)) {
      moduleAliases.add(sidecarPackage.package);
    }
    const moduleSignatures = signatureMapForSidecarPackage(sidecarPackage);
    const moduleSignatureEntries = Object.entries(moduleSignatures).sort(([a], [b]) => a.localeCompare(b));
    for (const rawAlias of moduleAliases) {
      if (!SAFE_IDENTIFIER_RE.test(rawAlias)) continue;
      const alias = emitIdentifier(rawAlias, 'pythonModule', node);
      if (usedExportNames.has(alias)) continue;
      usedExportNames.add(alias);
      let moduleTypeCast = '';
      if (moduleSignatureEntries.length > 0) {
        if (!emittedCallableType) {
          lines.push(
            '',
            `type ${callableTypeName}<T extends (...args: any[]) => Promise<unknown>> = T & { kwargs: { (kwargs: Record<string, unknown>): ReturnType<T>; (kwargs: Record<string, unknown>, ...args: Parameters<T>): ReturnType<T> } };`,
          );
          emittedCallableType = true;
        }
        const typeName = uniqueGeneratedName(
          emitIdentifier(`${upperFirst(alias)}PythonModule`, 'pythonModuleType', node),
          usedTypeNames,
        );
        lines.push(
          '',
          `type ${typeName} = Record<string, ${callableTypeName}<(...args: unknown[]) => Promise<unknown>>> & {`,
        );
        for (const [name, signature] of moduleSignatureEntries) {
          lines.push(`  ${emitObjectTypeKey(name)}: ${callableTypeName}<${signature}>;`);
        }
        lines.push('};');
        moduleTypeCast = ` as unknown as ${typeName}`;
      }
      lines.push(
        `export const ${alias} = ${clientName}.module(${JSON.stringify(sidecarPackage.package)})${moduleTypeCast};`,
      );
    }
    for (const binding of sidecarPackage.imports) {
      for (const rawName of binding.names) {
        const namedBinding = parseExternalNamedBinding(rawName);
        if (!namedBinding) continue;
        const alias = emitIdentifier(namedBinding.alias, 'pythonFunction', node);
        if (usedExportNames.has(alias)) continue;
        usedExportNames.add(alias);
        const signature = moduleSignatures[namedBinding.name];
        if (signature && !emittedCallableType) {
          lines.push(
            '',
            `type ${callableTypeName}<T extends (...args: any[]) => Promise<unknown>> = T & { kwargs: { (kwargs: Record<string, unknown>): ReturnType<T>; (kwargs: Record<string, unknown>, ...args: Parameters<T>): ReturnType<T> } };`,
          );
          emittedCallableType = true;
        }
        const typedCast = signature ? ` as unknown as ${callableTypeName}<${signature}>` : '';
        lines.push(
          `export const ${alias} = ${clientName}.bind(${JSON.stringify(sidecarPackage.package)}, ${JSON.stringify(namedBinding.name)})${typedCast};`,
        );
      }
    }
  }
  return lines;
}

export function generateIsland(node: IRNode): string[] {
  const childImports = kids(node, 'import').flatMap((child) => generateImport(child, { pythonSidecar: false }));
  const childExterns = kids(node, 'extern').flatMap((child) => generateExtern(child));
  const manifest = sidecarManifestFromNode(node);
  const sidecarClient = manifest ? generatePythonSidecarClient(manifest, node) : [];
  const childDefinitions = kids(node, 'fn').flatMap((child) => generateIslandChildDefinition(child));
  return [...new Set([...childImports, ...childExterns]), ...sidecarClient, ...childDefinitions];
}

function generateIslandChildDefinition(node: IRNode): string[] {
  return node.type === 'fn' ? generateFunction(node) : [];
}

// ── Use (cross-`.kern` symbol resolution) ───────────────────────────────

/** Translate a `.kern` source path to its compiled `.js` output path. */
function kernPathToJs(path: string): string {
  return path.endsWith('.kern') ? `${path.slice(0, -'.kern'.length)}.js` : path;
}

export function generateUse(node: IRNode): string[] {
  const props = propsOf<'use'>(node);
  const path = props.path;
  if (!path) return [];

  const safePath = emitImportSpecifier(kernPathToJs(path), node);
  const fromChildren = kids(node, 'from');
  if (fromChildren.length === 0) {
    // Side-effect-only `use path="..."` is unusual but legal — emits a
    // bare import for parity with the import node's side-effect form.
    return [`import '${safePath}';`];
  }

  // Every `from` child creates a local binding. `export=true` is an
  // ADDITIONAL re-export marker — it does not replace the local import.
  // (TS `export { x } from '...'` is a forwarding re-export and does NOT
  // create a local binding, so the two lines are independent: an import
  // line for the local binding, plus an export-from line for forwarding.)
  const importBindings: string[] = [];
  const typeImportBindings: string[] = [];
  const reExportBindings: string[] = [];
  const typeReExportBindings: string[] = [];
  for (const child of fromChildren) {
    const cp = propsOf<'from'>(child);
    const name = cp.name;
    if (!name) continue;
    const safeName = emitIdentifier(name, 'imported', child);
    const aliasRaw = cp.as;
    const safeAlias = aliasRaw ? emitIdentifier(aliasRaw, 'alias', child) : '';
    const isReExport = cp.export === 'true' || cp.export === true;
    const isTypeOnly = cp.kind === 'type';

    const binding = safeAlias ? `${safeName} as ${safeAlias}` : safeName;
    if (isTypeOnly) typeImportBindings.push(binding);
    else importBindings.push(binding);
    if (isReExport) {
      // Mirror the same `name as alias` form so the re-exported name matches
      // what consumers will see (`bar`, not `foo`) when an alias is set.
      if (isTypeOnly) typeReExportBindings.push(binding);
      else reExportBindings.push(binding);
    }
  }

  const lines: string[] = [];
  if (importBindings.length > 0) {
    lines.push(`import { ${importBindings.join(', ')} } from '${safePath}';`);
  }
  if (typeImportBindings.length > 0) {
    lines.push(`import type { ${typeImportBindings.join(', ')} } from '${safePath}';`);
  }
  if (reExportBindings.length > 0) {
    lines.push(`export { ${reExportBindings.join(', ')} } from '${safePath}';`);
  }
  if (typeReExportBindings.length > 0) {
    lines.push(`export type { ${typeReExportBindings.join(', ')} } from '${safePath}';`);
  }
  return lines;
}
