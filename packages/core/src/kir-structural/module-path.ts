import { compareCodePoints } from '../canonical-value/validate.js';
import { ModuleKirError } from './module-types.js';

function fail(path: string, message: string): never {
  throw new ModuleKirError('invalid-module-id', path, message);
}

export function normalizeModuleId(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'expected module id text');
  if (
    value.length === 0 ||
    !value.endsWith('.kern') ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':') ||
    value.includes('//') ||
    value.endsWith('/')
  ) {
    fail(path, 'expected normalized relative POSIX .kern id');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(path, 'module id must remain inside the artifact root');
  }
  return value;
}

function resolveSegments(moduleId: string, specifier: string, path: string): string {
  const output = moduleId.split('/').slice(0, -1);
  const source = specifier.startsWith('./') ? specifier.slice(2) : specifier;
  for (const segment of source.split('/')) {
    if (segment === '..') {
      if (output.length === 0) fail(path, 'import escapes the artifact root');
      output.pop();
    } else {
      output.push(segment);
    }
  }
  return output.join('/');
}

export function resolveModuleTarget(
  moduleId: string,
  specifier: string,
  ids: ReadonlySet<string>,
  path: string,
): string {
  const candidate = resolveSegments(moduleId, specifier, path);
  const exact = ids.has(candidate) ? candidate : undefined;
  const withExtension = ids.has(`${candidate}.kern`) ? `${candidate}.kern` : undefined;
  const target = exact ?? withExtension;
  if (target === undefined) throw new ModuleKirError('missing-module', path, `cannot resolve ${specifier}`);
  return target;
}

export function compareBindingKey(
  left: { imported: string; kind: string; local: string; reexport: boolean },
  right: { imported: string; kind: string; local: string; reexport: boolean },
): number {
  return compareCodePoints(
    [left.imported, left.kind, left.local, left.reexport ? '1' : '0'].join('\0'),
    [right.imported, right.kind, right.local, right.reexport ? '1' : '0'].join('\0'),
  );
}
