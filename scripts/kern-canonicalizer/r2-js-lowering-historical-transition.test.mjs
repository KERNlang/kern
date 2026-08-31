import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  digestM4145CompiledCoreJavaScript,
  reconstructCPy1LoweringCompiledCoreJavaScriptPaths,
  reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths,
} from './coverage-dependencies.mjs';
import {
  R2_JS_LOWERING_COMPILED_SUCCESSOR_TRANSITION,
  validateR2JavaScriptLoweringHistoricalTransition,
} from './r2-js-lowering-historical-transition.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');
const IDENTITY_ERROR = 'R2 JavaScript lowering historical transition immutable identity changed';
const NORMALIZED_PATH_ERROR = 'coverage dependency rejection: R2 JavaScript lowering successor inventory must contain unique normalized JavaScript paths';
const MEMBERSHIP_ERROR = 'coverage dependency rejection: R2 JavaScript lowering historical membership requires the authenticated current inventory';

function digest(paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) hash.update(`${path.length}:${path}`);
  return hash.digest('hex');
}

function compiledPaths(directory = DIST, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) compiledPaths(path, output);
    else if (entry.isFile() && entry.name.endsWith('.js')) output.push(relative(DIST, path).split(sep).join('/'));
  }
  return output.sort();
}

function cloneOwnDataTree(value) {
  if (value === null || typeof value !== 'object') return value;
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.ok(descriptor && Object.hasOwn(descriptor, 'value'));
    Object.defineProperty(copy, key, { ...descriptor, value: cloneOwnDataTree(descriptor.value) });
  }
  return copy;
}

function assertTypeError(callback, message) {
  assert.throws(callback, (error) => error instanceof TypeError && error.message === message);
}

function cPy1SuccessorPaths() {
  return reconstructCPy1LoweringCompiledCoreJavaScriptPaths(compiledPaths());
}

test('R2 JavaScript lowering authenticates the exact 346-to-332 inventory edge', () => {
  assert.equal(validateR2JavaScriptLoweringHistoricalTransition(), true);
  const transition = R2_JS_LOWERING_COMPILED_SUCCESSOR_TRANSITION;
  const paths = cPy1SuccessorPaths();
  assert.deepEqual({ count: paths.length, digest: digest(paths) }, transition.currentInventory);
  const predecessor = reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths(paths);
  assert.deepEqual({ count: predecessor.length, digest: digest(predecessor) }, transition.predecessorInventory);
  for (const path of transition.addedPaths) assert.equal(predecessor.includes(path), false, path);
});

test('R2 JavaScript lowering rejects tampered inventories before rebuilding R1', () => {
  const paths = cPy1SuccessorPaths();
  for (const candidate of [
    [...paths, 'unexpected.js'], paths.slice(1), paths.map((path, index) => index === 0 ? 'renamed.js' : path),
    [...paths, paths[0]], [...paths.slice(1), '../escape.js'], [...paths.slice(1), '/absolute.js'],
    [...paths.slice(1), 'dir\\escape.js'], [...paths.slice(1), './dot.js'],
  ]) assert.throws(() => reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths(candidate), /coverage dependency rejection/u);
  for (const path of ['../escape.js', 'directory/../escape.js']) {
    assertTypeError(() => reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths([...paths.slice(1), path]), NORMALIZED_PATH_ERROR);
  }
  for (const path of ['file.json', 'file.js.map']) {
    assertTypeError(() => reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths([...paths.slice(1), path]), NORMALIZED_PATH_ERROR);
  }
  const duplicateCaseVariant = paths.map((path) => path === 'runtime-kir.js' ? 'Runtime-kir.js' : path);
  duplicateCaseVariant.push('Runtime-kir.js');
  assertTypeError(() => reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths(duplicateCaseVariant), NORMALIZED_PATH_ERROR);
  const caseOnly = paths.map((path) => path === 'runtime-kir.js' ? 'Runtime-kir.js' : path);
  assertTypeError(() => reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths(caseOnly), MEMBERSHIP_ERROR);
});

test('R2 JavaScript lowering preserves input and predecessor order', () => {
  const transition = R2_JS_LOWERING_COMPILED_SUCCESSOR_TRANSITION;
  const reversed = cPy1SuccessorPaths().reverse();
  const before = [...reversed];
  const predecessor = reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths(reversed);
  assert.deepEqual(reversed, before);
  assert.deepEqual(predecessor, before.filter((path) => !transition.addedPaths.includes(path)));
});

test('R2 JavaScript lowering rejects hostile immutable-transition candidates without getters', () => {
  const transition = R2_JS_LOWERING_COMPILED_SUCCESSOR_TRANSITION;
  let getterRead = false;
  const accessor = { ...transition };
  Object.defineProperty(accessor, 'claim', { enumerable: true, configurable: true, get() { getterRead = true; return transition.claim; } });
  const nestedDescriptors = Object.getOwnPropertyDescriptors(transition.currentInventory);
  const hostileNested = Object.create({ inherited: true }, nestedDescriptors);
  const descriptors = Object.getOwnPropertyDescriptors(transition);
  descriptors.currentInventory = { ...descriptors.currentInventory, value: hostileNested };
  const nestedPrototype = Object.create(Object.getPrototypeOf(transition), descriptors);
  const clone = cloneOwnDataTree(transition);
  const trailingKey = cloneOwnDataTree(transition);
  Object.defineProperty(trailingKey, 'trailing', { value: true });
  const finalAddedPathDescriptors = Object.getOwnPropertyDescriptors(clone.addedPaths);
  const finalAddedPathIndex = String(clone.addedPaths.length - 1);
  finalAddedPathDescriptors[finalAddedPathIndex] = { ...finalAddedPathDescriptors[finalAddedPathIndex], value: 'different.js' };
  const finalAddedPath = Object.create(Object.getPrototypeOf(clone.addedPaths), finalAddedPathDescriptors);
  const finalAddedPathTransitionDescriptors = Object.getOwnPropertyDescriptors(clone);
  finalAddedPathTransitionDescriptors.addedPaths = { ...finalAddedPathTransitionDescriptors.addedPaths, value: finalAddedPath };
  const finalAddedPathTransition = Object.create(Object.getPrototypeOf(clone), finalAddedPathTransitionDescriptors);
  const reordered = Object.create(Object.getPrototypeOf(clone));
  for (const key of [...Reflect.ownKeys(clone)].reverse()) Object.defineProperty(reordered, key, Object.getOwnPropertyDescriptor(clone, key));
  const configurable = Object.getOwnPropertyDescriptors(transition);
  configurable.claim = { ...configurable.claim, configurable: true };
  const writable = Object.getOwnPropertyDescriptors(transition);
  writable.claim = { ...writable.claim, writable: true };
  assert.equal(validateR2JavaScriptLoweringHistoricalTransition(clone), true);
  for (const candidate of [
    Object.assign(Object.create({ inherited: true }), transition), { ...transition, toJSON() { return transition; } },
    { ...transition, [Symbol('extra')]: true }, Object.defineProperty({ ...transition }, 'hidden', { value: true }),
    accessor, nestedPrototype, trailingKey, finalAddedPathTransition, reordered, Object.create(Object.getPrototypeOf(transition), configurable),
    Object.create(Object.getPrototypeOf(transition), writable), null, false, 0, '',
  ]) assertTypeError(() => validateR2JavaScriptLoweringHistoricalTransition(candidate), IDENTITY_ERROR);
  assert.equal(getterRead, false);
});

test('R2 JavaScript lowering independently pins endpoints and frozen boundary', () => {
  const transition = R2_JS_LOWERING_COMPILED_SUCCESSOR_TRANSITION;
  assert.equal(transition.predecessorCommit, 'a8f5e9a7c8632faed10dd301056d1260928c9026');
  assert.equal(transition.successorCommit, '41f6c5ec5479e76b61a7401db04c5c08cc2b4394');
  assert.equal(digestM4145CompiledCoreJavaScript(), '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2');
  const source = readFileSync(resolve(ROOT, 'scripts/kern-canonicalizer/r2-js-lowering-historical-transition.mjs'), 'utf8');
  assert.doesNotMatch(source, /node:fs|node:child_process|readFileSync|readdirSync|process\.cwd|git show/u);
});
