import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  digestM4145CompiledCoreJavaScript,
  reconstructCPy1LoweringCompiledCoreJavaScriptPaths,
  reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths,
  reconstructR1RuntimeOwnerCompiledCoreJavaScriptPaths,
} from './coverage-dependencies.mjs';
import {
  R1_RUNTIME_OWNER_COMPILED_SUCCESSOR_TRANSITION,
  validateR1RuntimeOwnerHistoricalTransition,
} from './r1-runtime-owner-historical-transition.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');
const IMMUTABLE_IDENTITY_ERROR = 'R1 runtime owner historical transition immutable identity changed';
const NORMALIZED_PATH_ERROR = 'coverage dependency rejection: R1 runtime owner successor inventory must contain unique normalized JavaScript paths';
const MEMBERSHIP_ERROR = 'coverage dependency rejection: R1 runtime owner historical membership requires the authenticated current inventory';

function pathDigest(paths) {
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

function r1SuccessorPaths() {
  const cPy1Predecessor = reconstructCPy1LoweringCompiledCoreJavaScriptPaths(compiledPaths());
  return reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths(cPy1Predecessor);
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

function assertTypeErrorMessage(callback, message) {
  assert.throws(callback, (error) => error instanceof TypeError && error.message === message);
}

test('R1 runtime owner authenticates the exact 332-to-322 inventory edge', () => {
  assert.equal(validateR1RuntimeOwnerHistoricalTransition(), true);
  const transition = R1_RUNTIME_OWNER_COMPILED_SUCCESSOR_TRANSITION;
  const paths = r1SuccessorPaths();
  assert.deepEqual({ count: paths.length, digest: pathDigest(paths) }, transition.currentInventory);
  const predecessor = reconstructR1RuntimeOwnerCompiledCoreJavaScriptPaths(paths);
  assert.deepEqual({ count: predecessor.length, digest: pathDigest(predecessor) }, transition.predecessorInventory);
  for (const path of transition.addedPaths) assert.equal(predecessor.includes(path), false, path);
});

test('R1 runtime owner rejects inventory and transition tampering', () => {
  const transition = R1_RUNTIME_OWNER_COMPILED_SUCCESSOR_TRANSITION;
  const paths = r1SuccessorPaths();
  for (const candidate of [
    [...paths, 'unexpected.js'],
    paths.slice(1),
    paths.map((path, index) => index === 0 ? 'renamed.js' : path),
    [...paths, paths[0]],
    [...paths.slice(1), '../escape.js'],
    [...paths.slice(1), '/absolute.js'],
    [...paths.slice(1), 'dir\\escape.js'],
    [...paths.slice(1), './dot.js'],
  ]) assert.throws(() => reconstructR1RuntimeOwnerCompiledCoreJavaScriptPaths(candidate), /coverage dependency rejection/u);
  assert.throws(
    () => validateR1RuntimeOwnerHistoricalTransition({ ...transition, addedPaths: [...transition.addedPaths].reverse() }),
    /immutable identity changed/u,
  );
});

test('R1 runtime owner requires normalized parent-free paths before membership', () => {
  const paths = r1SuccessorPaths();
  for (const path of ['../escape.js', 'directory/../escape.js']) {
    assertTypeErrorMessage(
      () => reconstructR1RuntimeOwnerCompiledCoreJavaScriptPaths([...paths.slice(1), path]),
      NORMALIZED_PATH_ERROR,
    );
  }
});

test('R1 runtime owner preserves caller and predecessor path order', () => {
  const transition = R1_RUNTIME_OWNER_COMPILED_SUCCESSOR_TRANSITION;
  const reversed = r1SuccessorPaths().reverse();
  const before = [...reversed];
  const predecessor = reconstructR1RuntimeOwnerCompiledCoreJavaScriptPaths(reversed);
  assert.deepEqual(reversed, before);
  assert.deepEqual(predecessor, before.filter((path) => !transition.addedPaths.includes(path)));
});

test('R1 runtime owner treats case-only paths as distinct until membership authentication', () => {
  const paths = r1SuccessorPaths();
  const candidate = paths.map((path) => path === 'runtime-kir.js' ? 'Runtime-kir.js' : path);
  assertTypeErrorMessage(() => reconstructR1RuntimeOwnerCompiledCoreJavaScriptPaths(candidate), MEMBERSHIP_ERROR);
});

test('R1 runtime owner rejects hostile transition objects without running getters', () => {
  const transition = R1_RUNTIME_OWNER_COMPILED_SUCCESSOR_TRANSITION;
  const withPrototype = Object.assign(Object.create({ inherited: true }), transition);
  const withToJson = {
    ...transition,
    toJSON() {
      return transition;
    },
  };
  let getterRead = false;
  const withAccessor = { ...transition };
  Object.defineProperty(withAccessor, 'claim', {
    configurable: true,
    enumerable: true,
    get() {
      getterRead = true;
      return transition.claim;
    },
  });
  const withSymbol = { ...transition, [Symbol('extra')]: true };
  const withHidden = { ...transition };
  Object.defineProperty(withHidden, 'hidden', { value: true });
  const nestedDescriptors = Object.getOwnPropertyDescriptors(transition.currentInventory);
  const hostileNested = Object.create({ inherited: true }, nestedDescriptors);
  const topLevelDescriptors = Object.getOwnPropertyDescriptors(transition);
  topLevelDescriptors.currentInventory = {
    ...topLevelDescriptors.currentInventory,
    value: hostileNested,
  };
  const withNestedPrototype = Object.create(Object.getPrototypeOf(transition), topLevelDescriptors);
  const faithfulClone = cloneOwnDataTree(transition);
  const reordered = Object.create(Object.getPrototypeOf(faithfulClone));
  for (const key of [...Reflect.ownKeys(faithfulClone)].reverse()) {
    Object.defineProperty(reordered, key, Object.getOwnPropertyDescriptor(faithfulClone, key));
  }
  const configurableDescriptors = Object.getOwnPropertyDescriptors(transition);
  configurableDescriptors.claim = { ...configurableDescriptors.claim, configurable: true };
  const withConfigurable = Object.create(Object.getPrototypeOf(transition), configurableDescriptors);
  const writableDescriptors = Object.getOwnPropertyDescriptors(transition);
  writableDescriptors.claim = { ...writableDescriptors.claim, writable: true };
  const withWritable = Object.create(Object.getPrototypeOf(transition), writableDescriptors);
  assert.equal(validateR1RuntimeOwnerHistoricalTransition(faithfulClone), true);
  for (const candidate of [withPrototype, withToJson, withSymbol, withHidden, withNestedPrototype]) {
    assertTypeErrorMessage(() => validateR1RuntimeOwnerHistoricalTransition(candidate), IMMUTABLE_IDENTITY_ERROR);
  }
  for (const candidate of [reordered, withConfigurable, withWritable, null, false, 0, '']) {
    assertTypeErrorMessage(() => validateR1RuntimeOwnerHistoricalTransition(candidate), IMMUTABLE_IDENTITY_ERROR);
  }
  for (const currentInventory of [null, false, 0, '']) {
    const descriptors = Object.getOwnPropertyDescriptors(transition);
    descriptors.currentInventory = { ...descriptors.currentInventory, value: currentInventory };
    const candidate = Object.create(Object.getPrototypeOf(transition), descriptors);
    assertTypeErrorMessage(() => validateR1RuntimeOwnerHistoricalTransition(candidate), IMMUTABLE_IDENTITY_ERROR);
  }
  assertTypeErrorMessage(() => validateR1RuntimeOwnerHistoricalTransition(withAccessor), IMMUTABLE_IDENTITY_ERROR);
  assert.equal(getterRead, false);
});

test('R1 runtime owner independently pins both transition commits', () => {
  const transition = R1_RUNTIME_OWNER_COMPILED_SUCCESSOR_TRANSITION;
  assert.equal(transition.predecessorCommit, 'aae0a0fe44b1aaba88addcb1995cd66e2af2254d');
  assert.equal(transition.successorCommit, '9e3e9fb40eb73810d6e4ee5af80b85f500a6a9fc');
});

test('R1 runtime owner leaves the frozen M4.145 digest unchanged', () => {
  assert.equal(digestM4145CompiledCoreJavaScript(), '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2');
});

test('R1 transition definition has no live filesystem or process dependency', () => {
  const source = readFileSync(resolve(ROOT, 'scripts/kern-canonicalizer/r1-runtime-owner-historical-transition.mjs'), 'utf8');
  assert.doesNotMatch(source, /node:fs|node:child_process|readFileSync|readdirSync|process\.cwd|git show/u);
});
