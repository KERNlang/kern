/**
 * Module Generators — import.
 *
 * NOTE: generateModule remains in codegen-core.ts because it calls
 * generateCoreNode recursively for inline child definitions.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import { type SidecarManifest, sidecarManifestFromNode } from '../external-boundary.js';
import { shouldEmitImportForTarget } from '../import-metadata.js';
import { propsOf } from '../node-props.js';
import type { IRNode } from '../types.js';
import { emitIdentifier, emitImportSpecifier } from './emitters.js';
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

export function generateImport(node: IRNode): string[] {
  const props = propsOf<'import'>(node);
  const from = props.from;
  const names = props.names;
  const defaultImport = props.default;
  const isTypeOnly = props.types === 'true' || props.types === true;

  if (!from) return [];
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
  const inlineImport = hasInlineBinding ? generateImport(externChildImport(node)) : [];
  const childImports = children.flatMap((child) => generateImport(externChildImport(node, child)));
  return [...new Set([...inlineImport, ...childImports])];
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0].toLowerCase()}${value.slice(1)}`;
}

function emitStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

const SAFE_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

function parseNamedImportBinding(raw: string): { name: string; alias: string } | null {
  const match = raw.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u);
  if (!match) return null;
  return { name: match[1], alias: match[2] ?? match[1] };
}

const PYTHON_SIDECAR_RUNTIME = [
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
  'for line in sys.stdin:',
  '    request = {}',
  '    try:',
  '        request = json.loads(line)',
  '        target = _resolve(request["module"], request["method"])',
  '        args = request.get("args") or []',
  '        kwargs = request.get("kwargs") or {}',
  '        if not isinstance(args, list):',
  '            raise TypeError("args must be a list")',
  '        if not isinstance(kwargs, dict):',
  '            raise TypeError("kwargs must be an object")',
  '        with contextlib.redirect_stdout(sys.stderr):',
  '            result = target(*args, **kwargs)',
  '        response = {"id": request.get("id"), "ok": True, "result": result}',
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
  '        print(json.dumps(response), flush=True)',
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
    '  type Pending = { resolve: (value: unknown) => void; reject: (reason?: unknown) => void };',
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
    '        let message: { id?: number; ok?: boolean; result?: unknown; error?: { type?: string; message?: string; traceback?: string } };',
    '        try {',
    '          message = JSON.parse(line) as typeof message;',
    '        } catch {',
    '          return;',
    '        }',
    "        if (typeof message.id !== 'number') return;",
    '        const waiter = pending.get(message.id);',
    '        if (!waiter) return;',
    '        pending.delete(message.id);',
    '        if (message.ok) {',
    '          waiter.resolve(message.result);',
    '        } else {',
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
    '  return {',
    '    manifest,',
    '    module(moduleName: string): PythonModule {',
    '      if (!allowedModules.has(moduleName)) {',
    "        throw new Error(`Python module '${moduleName}' is not declared in sidecar island '${manifest.name}'`);",
    '      }',
    '      return new Proxy({}, {',
    '        get: (_target, prop) => {',
    "          if (typeof prop !== 'string' || prop === 'then') return undefined;",
    '          return this.bind(moduleName, prop);',
    '        },',
    '      }) as PythonModule;',
    '    },',
    '    bind(moduleName: string, method: string): PythonFunction {',
    '      const fn = ((...args: unknown[]) => this.call(moduleName, method, { args })) as PythonFunction;',
    '      fn.kwargs = (kwargs: Record<string, unknown>, ...args: unknown[]) => this.call(moduleName, method, { args, kwargs });',
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
    '      const request = { id, module: moduleName, method, args: payload.args ?? [], kwargs: payload.kwargs ?? {} };',
    '      return new Promise((resolve, reject) => {',
    '        pending.set(id, { resolve, reject });',
    '        active.stdin.write(`${JSON.stringify(request)}\\n`, (err) => {',
    '          if (!err) return;',
    '          pending.delete(id);',
    '          reject(err);',
    '        });',
    '      });',
    '    },',
    '    close(): void {',
    '      const active = proc;',
    '      if (!active) return;',
    '      proc = null;',
    "      rejectPending(new Error(`Python sidecar '${manifest.name}' closed`));",
    '      active.kill();',
    '    },',
    '    dispose(): void {',
    '      this.close();',
    '    },',
    '  } as const;',
    '}',
    '',
    `export const ${clientName} = ${factoryName}(${manifestName});`,
  );
  const usedExportNames = new Set([manifestName, clientName]);
  for (const sidecarPackage of manifest.packages) {
    const moduleAliases = new Set<string>();
    for (const binding of sidecarPackage.imports) {
      if (binding.default) moduleAliases.add(binding.default);
    }
    if (moduleAliases.size === 0 && SAFE_IDENTIFIER_RE.test(sidecarPackage.package)) {
      moduleAliases.add(sidecarPackage.package);
    }
    for (const rawAlias of moduleAliases) {
      if (!SAFE_IDENTIFIER_RE.test(rawAlias)) continue;
      const alias = emitIdentifier(rawAlias, 'pythonModule', node);
      if (usedExportNames.has(alias)) continue;
      usedExportNames.add(alias);
      lines.push(`export const ${alias} = ${clientName}.module(${JSON.stringify(sidecarPackage.package)});`);
    }
    for (const binding of sidecarPackage.imports) {
      for (const rawName of binding.names) {
        const namedBinding = parseNamedImportBinding(rawName);
        if (!namedBinding) continue;
        const alias = emitIdentifier(namedBinding.alias, 'pythonFunction', node);
        if (usedExportNames.has(alias)) continue;
        usedExportNames.add(alias);
        lines.push(
          `export const ${alias} = ${clientName}.bind(${JSON.stringify(sidecarPackage.package)}, ${JSON.stringify(namedBinding.name)});`,
        );
      }
    }
  }
  return lines;
}

export function generateIsland(node: IRNode): string[] {
  const childImports = kids(node, 'import').flatMap((child) => generateImport(child));
  const childExterns = kids(node, 'extern').flatMap((child) => generateExtern(child));
  const manifest = sidecarManifestFromNode(node);
  const sidecarClient = manifest ? generatePythonSidecarClient(manifest, node) : [];
  return [...new Set([...childImports, ...childExterns]), ...sidecarClient];
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
