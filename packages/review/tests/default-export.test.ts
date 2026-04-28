/**
 * default-export resolver tests — pin the mapping from each TypeScript
 * default-export shape to the call-graph-internal name that step 9b's
 * dead-export check needs to alias `(filePath, 'default')` against.
 *
 * Red-team #11 enumerated five shapes; getting any one wrong silently
 * reintroduces FPs (a Next.js page exported via `export { Page as default }`
 * would be flagged dead because the seed says `default` but the call
 * graph stored `Page`). One test per shape, no shortcuts.
 */

import { Project, type SourceFile } from 'ts-morph';
import { resolveDefaultExportName } from '../src/default-export.js';

function inProject(content: string): SourceFile {
  const project = new Project({
    compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100 },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  return project.createSourceFile('/src/m.ts', content);
}

describe('resolveDefaultExportName', () => {
  it('resolves `export default function Page() {}` to "Page"', () => {
    const sf = inProject(`export default function Page() { return null; }\n`);
    expect(resolveDefaultExportName(sf)).toBe('Page');
  });

  it('resolves `export default class Page {}` to "Page"', () => {
    const sf = inProject(`export default class Page { render() { return null; } }\n`);
    expect(resolveDefaultExportName(sf)).toBe('Page');
  });

  it('resolves `export default x` (local identifier) to "x"', () => {
    const sf = inProject(`function Page() { return null; }\nexport default Page;\n`);
    expect(resolveDefaultExportName(sf)).toBe('Page');
  });

  it('resolves `export { x as default }` to "x" — the rename form red-team #11 specifically called out', () => {
    const sf = inProject(`function Page() { return null; }\nexport { Page as default };\n`);
    expect(resolveDefaultExportName(sf)).toBe('Page');
  });

  it('returns undefined for anonymous `export default function () {}`', () => {
    const sf = inProject(`export default function () { return null; }\n`);
    // The call graph keys anonymous defaults under the literal "default";
    // callers should fall back to that when this returns undefined.
    expect(resolveDefaultExportName(sf)).toBeUndefined();
  });

  it('returns undefined for `export default 42` (literal)', () => {
    const sf = inProject(`export default 42;\n`);
    expect(resolveDefaultExportName(sf)).toBeUndefined();
  });

  it('returns undefined for `export default { foo: 1 }` (object literal)', () => {
    const sf = inProject(`export default { foo: 1 };\n`);
    expect(resolveDefaultExportName(sf)).toBeUndefined();
  });

  it('returns undefined for a file with NO default export', () => {
    const sf = inProject(`export const a = 1;\nexport function b() {}\n`);
    expect(resolveDefaultExportName(sf)).toBeUndefined();
  });

  it('still resolves the name when the function carries `export default` keyword inline', () => {
    // Same as the first case in shape but worth pinning: ts-morph treats
    // this as a FunctionDeclaration with hasExportKeyword + isDefaultExport.
    const sf = inProject(`export default async function fetchUser(id: string) { return id; }\n`);
    expect(resolveDefaultExportName(sf)).toBe('fetchUser');
  });
});
