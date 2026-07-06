import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import type {
  AsyncRuntimeCapabilityProvider,
  RuntimeCapabilityCall,
  RuntimeCapabilityValue,
} from '@kernlang/core/runner';

export interface CliAsyncFsCapabilityOptions {
  readonly readRoot: string;
  readonly writeRoot?: string;
}

export interface CliAsyncFsCapabilitySetup {
  readonly provider: AsyncRuntimeCapabilityProvider;
  readonly providedAsyncCapabilities: readonly string[];
}

export async function createCliAsyncFsCapability(
  options: CliAsyncFsCapabilityOptions,
): Promise<CliAsyncFsCapabilitySetup> {
  const readRoot = await realpath(options.readRoot);
  const writeRoot = options.writeRoot ? await realpath(options.writeRoot) : undefined;
  const providedAsyncCapabilities = writeRoot ? ['fs.list', 'fs.readText', 'fs.writeText'] : ['fs.list', 'fs.readText'];

  return {
    providedAsyncCapabilities,
    provider: {
      async list(call) {
        const target = await existingPathUnderRoot(readRoot, pathInput(call, 'fs.list'), 'fs.list path');
        const entries = await readdir(target, { withFileTypes: true });
        return entries.map((entry) => entry.name).sort();
      },
      async readText(call) {
        const target = await existingPathUnderRoot(readRoot, pathInput(call, 'fs.readText'), 'fs.readText path');
        return await readFile(target, 'utf-8');
      },
      ...(writeRoot
        ? {
            async writeText(call: RuntimeCapabilityCall) {
              const input = recordInput(call.input, 'fs.writeText');
              const path = nonEmptyStringField(input, 'path', 'fs.writeText path');
              const text = stringField(input, 'text', 'fs.writeText text');
              const target = await writablePathUnderRoot(writeRoot, path);
              await rejectSymlinkTarget(target);
              await writeTextNoFollow(target, text);
              return true;
            },
          }
        : {}),
    },
  };
}

function pathInput(call: RuntimeCapabilityCall, label: string): string {
  const input = recordInput(call.input, label);
  return nonEmptyStringField(input, 'path', `${label} path`);
}

function recordInput(
  input: RuntimeCapabilityValue | undefined,
  label: string,
): Readonly<Record<string, RuntimeCapabilityValue>> {
  if (!isRecordInput(input)) {
    throw new Error(`${label} input must be a record.`);
  }
  return input;
}

function isRecordInput(
  input: RuntimeCapabilityValue | undefined,
): input is Readonly<Record<string, RuntimeCapabilityValue>> {
  return input !== undefined && input !== null && typeof input === 'object' && !Array.isArray(input);
}

function stringField(input: Readonly<Record<string, RuntimeCapabilityValue>>, field: string, label: string): string {
  const value = input[field];
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function nonEmptyStringField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  field: string,
  label: string,
): string {
  const value = stringField(input, field, label);
  if (value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

async function existingPathUnderRoot(root: string, path: string, label: string): Promise<string> {
  const resolved = resolve(root, path);
  const target = await realpath(resolved);
  if (!isPathInside(root, target)) {
    throw new Error(`${label} escapes fs root.`);
  }
  return target;
}

async function writablePathUnderRoot(root: string, path: string): Promise<string> {
  const resolved = resolve(root, path);
  if (!isPathInside(root, resolved)) {
    throw new Error('fs.writeText path escapes fs write root.');
  }
  const parent = await realpath(dirname(resolved));
  if (!isPathInside(root, parent)) {
    throw new Error('fs.writeText parent escapes fs write root.');
  }
  const target = resolve(parent, basename(resolved));
  if (!isPathInside(root, target)) {
    throw new Error('fs.writeText path escapes fs write root.');
  }
  return target;
}

async function rejectSymlinkTarget(target: string): Promise<void> {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error('fs.writeText target must not be a symlink.');
    }
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return;
    throw error;
  }
}

async function writeTextNoFollow(target: string, text: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o666,
    );
    await handle.writeFile(text, 'utf-8');
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ELOOP')) {
      throw new Error('fs.writeText target must not be a symlink.');
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function isPathInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
