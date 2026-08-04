import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  assertPublicHandlerBuiltAbiClosure,
  assertPublicHandlerAbiClosure,
  RUNTIME_DYNAMIC_ESCAPE_BINDINGS,
  RUNTIME_REFLECTIVE_ESCAPE_MEMBERS,
  runtimeJavaScriptImportClosure,
  runtimeModuleSpecifiers,
} from '../runtime-envelope-import-closure.mjs';

test('public source and built JavaScript dependency graphs are acyclic and machine-only', () => {
  const coreSource = resolve('packages/core/src');
  assert.ok(assertPublicHandlerAbiClosure(coreSource).size > 0);
  assert.ok(assertPublicHandlerBuiltAbiClosure(resolve('packages/core/dist')).size > 0);
});

test('built JavaScript dependency graph rejects a cycle', () => {
  const entry = '/repo/dist/runtime-handler.js';
  const dependency = '/repo/dist/runtime-envelope/handler-entry.js';
  const specifier = (fromPath, targetPath) => {
    const path = relative(dirname(fromPath), targetPath);
    return path.startsWith('.') ? path : `./${path}`;
  };
  const sources = new Map([
    [entry, `import '${specifier(entry, dependency)}';`],
    [dependency, `import '${specifier(dependency, entry)}';`],
  ]);
  assert.throws(
    () => runtimeJavaScriptImportClosure([entry], (path) => sources.get(path), new Set(), false),
    /runtime module dependency cycle/u,
  );
});

test('source and built closures reject every frozen dynamic-loader escape family', () => {
  assert.deepEqual(RUNTIME_DYNAMIC_ESCAPE_BINDINGS, [
    'Bun',
    'Deno',
    'Function',
    'WebAssembly',
    'constructor',
    'createRequire',
    'eval',
    'global',
    'globalThis',
    'importScripts',
    'module',
    'process',
  ]);
  assert.deepEqual(RUNTIME_REFLECTIVE_ESCAPE_MEMBERS, [
    'construct',
    'get',
    'getOwnPropertyDescriptor',
    'getOwnPropertyDescriptors',
    'getPrototypeOf',
  ]);
  const mutants = [
    'process.getBuiltinModule("node:fs")',
    'process["getBuiltinModule"]("node:fs")',
    'eval("import(\\"node:fs\\")")',
    '(0, eval)("import(\\"node:fs\\")")',
    'Function("return import(\\"node:fs\\")")()',
    'globalThis["Function"]("return import(\\"node:fs\\")")()',
    '(() => {}).constructor("return import(\\"node:fs\\")")()',
    'module.require("node:fs")',
    'createRequire(import.meta.url)("node:fs")',
    'WebAssembly.compile(bytes)',
    'Deno.readTextFile("secret")',
    'Bun.file("secret")',
    'importScripts("https://example.invalid/module.js")',
    'const host = globalThis; host.Function("return import(\\"node:fs\\")")()',
    'const { Function: Build } = globalThis; Build("return import(\\"node:fs\\")")()',
    'const { process: hostProcess } = globalThis; hostProcess.getBuiltinModule("node:fs")',
    'const { constructor: Build } = (() => {}); Build("return import(\\"node:fs\\")")()',
    'let Build; ({ constructor: Build } = (() => {})); Build("return process")()',
    'let Build; ({ ["con" + "structor"]: Build } = (() => {})); Build("return process")()',
    'let Build; [Build] = [Math.max.constructor]; Build("return process")()',
    'let Build; ({ value: { constructor: Build } } = { value: (() => {}) }); Build("return process")()',
    'let Build; ({ constructor: Build = fallback } = (() => {})); Build("return process")()',
    'let host; ({ ...host } = globalThis); host.Function("return process")()',
    'const box = {}; ({ constructor: box.build } = (() => {})); box.build("return process")()',
    'const box = []; ({ constructor: box[0] } = (() => {})); box[0]("return process")()',
    'const box = { slot: {} }; ({ constructor: box.slot.build } = (() => {})); box.slot.build("return process")()',
    'const box = {}; [box.build] = [Math.max.constructor]; box.build("return process")()',
    'const { value: { constructor: Build } } = { value: (() => {}) }; Build("return process")()',
    'const { safe: Build = Math.max.constructor } = {}; Build("return process")()',
    'let Build; ({ safe: Build = Math.max.constructor } = {}); Build("return process")()',
    'function leak() { ({ constructor: this.build } = (() => {})); this.build("return process")(); }',
    'const get = (target, key) => target[key]; const box = {}; box.build ||= get({}, "constructor"); box.build("return process")()',
    'const get = (target, key) => target[key]; const box = { build: true }; box.build &&= get({}, "constructor"); box.build("return process")()',
    'const get = (target, key) => target[key]; const box = {}; box.build ??= get({}, "constructor"); box.build("return process")()',
    'const get = (target, key) => target[key]; const box = {}; (box.build ??= get({}, "constructor"))("return process")()',
    'const get = (target, key) => target[key]; const { safe: Build = true ? get({}, "constructor") : null } = {}; Build("return process")()',
    'const get = (target, key) => target[key]; const { safe: Build = (0, get({}, "constructor")) } = {}; Build("return process")()',
    'const get = (target, key) => target[key]; const { safe: Build = false || get({}, "constructor") } = {}; Build("return process")()',
    'const get = (target, key) => target[key]; const { safe: Build = true && get({}, "constructor") } = {}; Build("return process")()',
    'const get = (target, key) => target[key]; const { safe: Build = null ?? get({}, "constructor") } = {}; Build("return process")()',
    'const get = (target, key) => target[key]; async function leak() { const { safe: Build = await get({}, "constructor") } = {}; Build("return process")(); }',
    'const get = (target, key) => target[key]; const Build = get({}, "constructor") satisfies unknown; Build("return process")()',
    'const get = (target, key) => target[key]; const Build = get({}, "constructor")<unknown>; Build("return process")()',
    'const get = (target, key) => target[key]; const invoke = (fn) => (true ? fn : null)("return process")(); invoke(get({}, "constructor"))',
    'var { constructor: Build } = (() => {}); { var Build; Build("return process")(); }',
    'globalThis["Fun" + "ction"]("return import(\\"node:fs\\")")()',
    '(() => {})["con" + "structor"]("return import(\\"node:fs\\")")()',
    'Reflect.get(globalThis, "Function")("return import(\\"node:fs\\")")()',
    'Reflect.get(Object.prototype.toString, "constructor")("return import(\\"node:fs\\")")()',
    'const { get: recover } = Reflect; recover(Object.prototype.toString, "constructor")("return import(\\"node:fs\\")")()',
    'const { process: { getBuiltinModule: load } } = globalThis; load("node:fs")',
    'const Build = Object.prototype.toString.constructor; Build("return import(\\"node:fs\\")")()',
    'const Build = Object.getPrototypeOf(() => {}).constructor; Build("return import(\\"node:fs\\")")()',
    'const { constructor: Build } = Object.getPrototypeOf(() => {}); Build("return import(\\"node:fs\\")")()',
    'const getHost = () => globalThis; const host = getHost(); host.Function("return import(\\"node:fs\\")")()',
    'const Build = (() => {})[`con${""}structor`]; Build("return import(\\"node:fs\\")")()',
    'const suffix = key; const Build = (() => {})[`con${suffix}structor`]; Build("return import(\\"node:fs\\")")()',
    'const Build = (() => {})[key]; Build("return import(\\"node:fs\\")")()',
    '(() => {})[key]("return import(\\"node:fs\\")")()',
    'const gap = key; const Build = (() => {})["con" + gap + "structor"]; Build("return import(\\"node:fs\\")")()',
    'const { [key]: Build } = (() => {}); Build("return import(\\"node:fs\\")")()',
    'const { [`con${key}structor`]: Build } = (() => {}); Build("return import(\\"node:fs\\")")()',
    'Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor").value("return import(\\"node:fs\\")")()',
    'Reflect.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor").value("return import(\\"node:fs\\")")()',
    'Object.getOwnPropertyDescriptors(Object.getPrototypeOf(() => {})).constructor.value("return import(\\"node:fs\\")")()',
    'const box = [Math.max.constructor]; box[0]("return import(\\"node:fs\\")")()',
    'const box = { build: Math.max.constructor }; box.build("return import(\\"node:fs\\")")()',
    'const box = {}; box.build = Math.max.constructor; box.build("return import(\\"node:fs\\")")()',
    'const pick = (value) => value; pick(Math.max.constructor)("return import(\\"node:fs\\")")()',
    'const box = [Object.constructor]; box[0]("return import(\\"node:fs\\")")()',
    'function local() {} const box = [local.constructor]; box[0]("return import(\\"node:fs\\")")()',
    'class Local {} const box = [Local.constructor]; box[0]("return import(\\"node:fs\\")")()',
    'const box = { r: Reflect }; box.r.get(Object.prototype.toString, "constructor")("return import(\\"node:fs\\")")()',
    'const pick = (r) => r.get; pick(Reflect)(Object.prototype.toString, "constructor")("return import(\\"node:fs\\")")()',
    'const [r] = [Reflect]; r.get(Object.prototype.toString, "constructor")("return import(\\"node:fs\\")")()',
    'export const leak = Reflect',
    'const imported = unknownValue; const box = [imported.constructor]; box[0]("return import(\\"node:fs\\")")()',
    'const imported = unknownValue; const box = { build: imported.constructor }; box.build("return import(\\"node:fs\\")")()',
    'const imported = unknownValue; const box = {}; box.build = imported.constructor; box.build("return import(\\"node:fs\\")")()',
    'const imported = unknownValue; const pick = (value) => value; pick(imported.constructor)("return import(\\"node:fs\\")")()',
    'const imported = unknownValue; const wrap = (value) => ({ value }); wrap(imported.constructor).value("return import(\\"node:fs\\")")()',
    'const imported = unknownValue; const run = (value) => value("return import(\\"node:fs\\")")(); run(imported.constructor)',
    'const M = Math; const box = [M.max.constructor]; box[0]("return import(\\"node:fs\\")")()',
    'const get = (target, key) => target[key]; get(Object.prototype.toString, "constructor")("return process")()',
    'const get = (target, key) => target[key]; get({}, "constructor")("return process")()',
    'const get = (target, key) => target[key]; const recover = get; recover({}, "constructor")("return process")()',
    'const get = (target, key) => target[key]; const key = "con" + "structor"; get({}, key)("return process")()',
    'const get = (target, key) => target[key]; get({}, "constructor").call(null, "return process")()',
    'const get = (target, key) => target[key]; new (get({}, "constructor"))("return process")',
    'const get = (target, key) => target[key]; get({}, "constructor")`return process`()',
    'const get = (target, key) => target[key]; const box = {}; if (flag) box.build = get({}, "constructor"); box.build("return process")()',
    'const get = (target, key) => target[key]; const build = get({}, "constructor"); const run = () => build("return process")(); run()',
  ];
  for (const mutant of mutants) {
    assert.throws(() => runtimeModuleSpecifiers(mutant, 'mutant.ts'), /runtime-envelope import closure/u, mutant);
    assert.throws(
      () => runtimeJavaScriptImportClosure(['/repo/mutant.js'], () => mutant, new Set(), false),
      /runtime-envelope import closure/u,
      mutant,
    );
  }
});

test('ordinary descriptor inspection and approved direct reflection remain available', () => {
  const safeSources = [
    'const APPLY = Reflect.apply; export const call = (fn, receiver, args) => APPLY(fn, receiver, args)',
    'export const inspect = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value',
    'export const inspectAll = (value, key) => Object.getOwnPropertyDescriptors(value)[key]?.value',
    'export const inspectClass = (cls) => [cls.constructor?.params, cls.constructor?.body]',
    'const identity = (value) => value; export const number = identity(7)',
    'const get = (target, key) => target[key]; export const value = get({}, "safe")',
    'const get = (target, key) => target[key]; export const length = get({}, "safe").length',
    'const get = (target, key) => target[key]; if (flag) { const value = get({}, key); void value; } if (other) { const value = []; value.push(1); }',
    'let value; ({ safe: value } = { safe: 7 }); export const result = value',
    'let value; [value] = [7]; export const result = value',
    'const box = {}; ({ safe: box.value } = { safe: 7 }); export const result = box.value',
    'const box = []; [box[0]] = [7]; export const result = box[0]',
    'const { safe: value = 7 } = {}; export const result = value',
    'const box = {}; box.value ||= 7; box.value &&= 8; box.value ??= 9; export const result = box.value',
    'const value = true ? 7 : 8; export const result = (0, value || 9)',
    'var value = 7; { var value; } export const result = value',
  ];
  for (const source of safeSources) {
    assert.deepEqual(runtimeModuleSpecifiers(source, 'safe.ts'), [], source);
  }
});

test('public source closure rejects modules outside the exact machine-owner set', () => {
  const coreSource = resolve('packages/core/src');
  const entry = resolve(coreSource, 'runtime-handler.ts');
  const unexpected = resolve(coreSource, 'unexpected-runtime-owner.ts');
  const original = readFileSync(entry, 'utf8');
  let unexpectedRead = false;
  const sources = new Map([
    [entry, `${original}\nimport './unexpected-runtime-owner.js';\n`],
    [unexpected, 'export {};\n'],
  ]);
  assert.throws(
    () => assertPublicHandlerAbiClosure(coreSource, (path) => {
      if (path === unexpected) unexpectedRead = true;
      return sources.get(path) ?? readFileSync(path, 'utf8');
    }),
    /unapproved machine owner/u,
  );
  assert.equal(unexpectedRead, false);
});

test('public built closure rejects modules outside the exact machine-owner set', () => {
  const coreDist = resolve('packages/core/dist');
  const entry = resolve(coreDist, 'runtime-handler.js');
  const unexpected = resolve(coreDist, 'unexpected-runtime-owner.js');
  const original = readFileSync(entry, 'utf8');
  let unexpectedRead = false;
  const sources = new Map([
    [entry, `${original}\nimport './unexpected-runtime-owner.js';\n`],
    [unexpected, 'export {};\n'],
  ]);
  assert.throws(
    () => assertPublicHandlerBuiltAbiClosure(coreDist, (path) => {
      if (path === unexpected) unexpectedRead = true;
      return sources.get(path) ?? readFileSync(path, 'utf8');
    }),
    /unapproved machine owner/u,
  );
  assert.equal(unexpectedRead, false);
});

test('classified literal loaders stay visible while nonliteral loaders fail closed', () => {
  assert.deepEqual(runtimeModuleSpecifiers('require("./dependency.js")', 'entry.ts'), ['./dependency.js']);
  assert.deepEqual(runtimeModuleSpecifiers('import("./dependency.js")', 'entry.ts'), ['./dependency.js']);
  assert.throws(() => runtimeModuleSpecifiers('require(name)', 'entry.ts'), /non-literal require/u);
  assert.throws(() => runtimeModuleSpecifiers('import(name)', 'entry.ts'), /non-literal dynamic import/u);
});

test('machine-owner policy loads independently of the caller working directory', () => {
  const moduleUrl = pathToFileURL(resolve('scripts/runtime-contract-v1/runtime-machine-owner-allowlist.mjs')).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `import ${JSON.stringify(moduleUrl)}`], {
    cwd: resolve('packages/cli'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
