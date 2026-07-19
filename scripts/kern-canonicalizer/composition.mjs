#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

export const CANONICALIZER_COMPOSITION_FORMAT = 'kern.canonicalizer.composition.1';
export const CANONICALIZER_COMPOSITION_RECIPE = 'concat-ordered-members-exact-bytes.1';
export const CANONICALIZER_COMPOSITION_MEMBERS = Object.freeze([
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern',
  'examples/kern-canonicalizer/canonicalizer.kern',
]);
export const CANONICALIZER_COMPOSITE_PATH =
  'examples/kern-canonicalizer/canonicalizer.composed.kern';
export const CANONICALIZER_COMPOSITION_RECORD_PATH =
  'scripts/kern-canonicalizer/composition.json';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message) {
  throw new TypeError(`composition rejection: ${message}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function plainRecord(value, fields, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a plain record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain record`);
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    keys.some((key) => typeof key !== 'string') ||
    keys.some((key) => descriptors[key].get || descriptors[key].set || !descriptors[key].enumerable)
  ) {
    fail(`${label} must be inspectable plain data`);
  }
  const actual = [...keys].sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly ${expected.join(',')}`);
  }
  return value;
}

function denseArray(value, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be a dense plain array`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) {
    fail(`${label} must be a dense plain array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      fail(`${label} must be a dense plain array`);
    }
  }
  return value;
}

function safeRepositoryPath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes('\\') ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    fail(`${label} must be a normalized relative path`);
  }
  return value;
}

function safePath(value, label) {
  const path = safeRepositoryPath(value, label);
  if (!path.endsWith('.kern')) fail(`${label} must be a normalized relative .kern path`);
  return path;
}

function sha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be lowercase SHA-256`);
  }
  return value;
}

function byteLength(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer`);
  return value;
}

function containedRegularFile(root, path) {
  const canonicalRoot = realpathSync(root);
  const resolved = resolve(canonicalRoot, safeRepositoryPath(path, 'path'));
  let stat;
  let real;
  try {
    stat = lstatSync(resolved);
    real = realpathSync(resolved);
  } catch {
    fail(`${path} is missing`);
  }
  const fromRoot = relative(canonicalRoot, real);
  const escaped = fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
  if (!stat.isFile() || real !== resolved || escaped) {
    fail(`${path} must be a contained regular file`);
  }
  return readFileSync(resolved);
}

function memberBytes(root, path) {
  const bytes = containedRegularFile(root, path);
  if (bytes.length < 2 || bytes.at(-1) !== 0x0a || bytes.at(-2) === 0x0a) {
    fail(`${path} must end in exactly one trailing LF`);
  }
  try {
    utf8Decoder.decode(bytes);
  } catch {
    fail(`${path} must be valid UTF-8`);
  }
  return bytes;
}

function metadata(path, bytes) {
  return { bytes: bytes.length, path, sha256: digest(bytes) };
}

export function validateCanonicalizerCompositionRecord(input) {
  const record = plainRecord(input, ['composite', 'format', 'members', 'recipe'], 'record');
  if (record.format !== CANONICALIZER_COMPOSITION_FORMAT) {
    fail(`format must be ${CANONICALIZER_COMPOSITION_FORMAT}`);
  }
  if (record.recipe !== CANONICALIZER_COMPOSITION_RECIPE) {
    fail(`recipe must be ${CANONICALIZER_COMPOSITION_RECIPE}`);
  }
  const members = denseArray(record.members, 'members').map((member, index) => {
    const item = plainRecord(member, ['bytes', 'path', 'sha256'], `members[${index}]`);
    const path = safePath(item.path, `members[${index}].path`);
    if (path !== CANONICALIZER_COMPOSITION_MEMBERS[index]) {
      fail(`members must exactly match the fixed ordered canonicalizer members`);
    }
    return {
      bytes: byteLength(item.bytes, `members[${index}].bytes`),
      path,
      sha256: sha256(item.sha256, `members[${index}].sha256`),
    };
  });
  if (members.length !== CANONICALIZER_COMPOSITION_MEMBERS.length) {
    fail(`members must exactly match the fixed ordered canonicalizer members`);
  }
  const compositeInput = plainRecord(record.composite, ['bytes', 'path', 'sha256'], 'composite');
  const compositePath = safePath(compositeInput.path, 'composite.path');
  if (compositePath !== CANONICALIZER_COMPOSITE_PATH) {
    fail(`composite.path must be ${CANONICALIZER_COMPOSITE_PATH}`);
  }
  return {
    composite: {
      bytes: byteLength(compositeInput.bytes, 'composite.bytes'),
      path: compositePath,
      sha256: sha256(compositeInput.sha256, 'composite.sha256'),
    },
    format: CANONICALIZER_COMPOSITION_FORMAT,
    members,
    recipe: CANONICALIZER_COMPOSITION_RECIPE,
  };
}

export function canonicalCompositionRecordBytes(input) {
  const record = validateCanonicalizerCompositionRecord(input);
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
}

export function createCanonicalizerComposition(options = {}) {
  const root = options.root ?? ROOT;
  const members = CANONICALIZER_COMPOSITION_MEMBERS.map((path) => {
    const bytes = memberBytes(root, path);
    return { bytes, metadata: metadata(path, bytes) };
  });
  const compositeBytes = Buffer.concat(members.map((member) => member.bytes));
  return {
    compositeBytes,
    record: {
      composite: metadata(CANONICALIZER_COMPOSITE_PATH, compositeBytes),
      format: CANONICALIZER_COMPOSITION_FORMAT,
      members: members.map((member) => member.metadata),
      recipe: CANONICALIZER_COMPOSITION_RECIPE,
    },
  };
}

export function verifyCanonicalizerComposition(options = {}) {
  const root = options.root ?? ROOT;
  const recordInput = options.record ?? JSON.parse(
    containedRegularFile(root, CANONICALIZER_COMPOSITION_RECORD_PATH).toString('utf8'),
  );
  const record = validateCanonicalizerCompositionRecord(recordInput);
  const memberSources = record.members.map((member) => {
    const bytes = memberBytes(root, member.path);
    if (bytes.length !== member.bytes || digest(bytes) !== member.sha256) {
      fail(`${member.path} does not match its authenticated metadata`);
    }
    return bytes;
  });
  const recomposed = Buffer.concat(memberSources);
  if (recomposed.length !== record.composite.bytes || digest(recomposed) !== record.composite.sha256) {
    fail('recomposed bytes do not match composite metadata');
  }
  const checkedIn = containedRegularFile(root, record.composite.path);
  if (!checkedIn.equals(recomposed)) fail('checked-in composite bytes differ from authenticated recomposition');
  let source;
  try {
    source = utf8Decoder.decode(checkedIn);
  } catch {
    fail('checked-in composite must be valid UTF-8');
  }
  return { compositeBytes: checkedIn, record, source };
}

function atomicWrite(root, path, bytes) {
  const canonicalRoot = realpathSync(root);
  safeRepositoryPath(path, 'output path');
  const target = resolve(canonicalRoot, path);
  const parent = dirname(target);
  let canonicalParent;
  try {
    canonicalParent = realpathSync(parent);
  } catch {
    fail(`output parent for ${path} is missing`);
  }
  const fromRoot = relative(canonicalRoot, canonicalParent);
  if (
    canonicalParent !== parent ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    fail(`output parent for ${path} must be contained and not a symlink`);
  }
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (!stat.isFile() || realpathSync(target) !== target) fail(`${path} must be a contained regular file`);
  }
  const temporary = resolve(parent, `.${basename(target)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function writeCanonicalizerComposition(options = {}) {
  const root = options.root ?? ROOT;
  const built = createCanonicalizerComposition({ root });
  atomicWrite(root, CANONICALIZER_COMPOSITE_PATH, built.compositeBytes);
  atomicWrite(root, CANONICALIZER_COMPOSITION_RECORD_PATH, canonicalCompositionRecordBytes(built.record));
  return verifyCanonicalizerComposition({ root });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--write') {
    const verified = writeCanonicalizerComposition();
    process.stdout.write(
      `KERN canonicalizer composition wrote ${verified.record.members.length} members and ${verified.compositeBytes.length} bytes.\n`,
    );
  } else if (process.argv.length === 2) {
    const verified = verifyCanonicalizerComposition();
    process.stdout.write(
      `KERN canonicalizer composition verified ${verified.record.members.length} members and ${verified.compositeBytes.length} bytes.\n`,
    );
  } else {
    fail('usage: composition.mjs [--write]');
  }
}
