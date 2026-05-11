/** Slice C-cell-v4 — auto-emit `import { useState } from 'react'` when a
 *  body-stmt `cell` node appears in the IR. Covers both detection and the
 *  smart-merge inject logic. */

import { detectReactHookDeps, injectReactHookImports } from '../src/codegen/react-hook-imports.js';
import { parseDocumentWithDiagnostics } from '../src/parser.js';

describe('detectReactHookDeps', () => {
  test('cell inside handler triggers useState dep', () => {
    const { root } = parseDocumentWithDiagnostics(
      ['fn name=inc returns=number', '  handler lang="kern"', '    cell name=count initial=0'].join('\n'),
    );
    expect([...detectReactHookDeps(root)]).toEqual(['useState']);
  });

  test('multiple cells still produce single useState dep', () => {
    const { root } = parseDocumentWithDiagnostics(
      [
        'fn name=multi returns=any',
        '  handler lang="kern"',
        '    cell name=a initial=0',
        '    cell name=b initial=1',
        '    return value="a + b"',
      ].join('\n'),
    );
    expect([...detectReactHookDeps(root)]).toEqual(['useState']);
  });

  test('no cells means empty dep set', () => {
    const { root } = parseDocumentWithDiagnostics(
      ['fn name=add returns=number', '  handler lang="kern"', '    return value="1 + 2"'].join('\n'),
    );
    expect(detectReactHookDeps(root).size).toBe(0);
  });

  test('top-level state inside screen does NOT trigger auto-import', () => {
    // `state` is the existing screen-level primitive; its react import is
    // historically author-emitted. Auto-emitting here would risk
    // double-import on hand-written code. Cell-only scope keeps the slice
    // safe.
    const { root } = parseDocumentWithDiagnostics(
      ['screen name=S', '  state name=count initial=0', '  render', '    text value="hi"'].join('\n'),
    );
    expect(detectReactHookDeps(root).size).toBe(0);
  });
});

describe('injectReactHookImports', () => {
  const deps = new Set<'useState'>(['useState']);

  test('inserts import after generated-header source comment', () => {
    const code = ['// @kern-source: x:1', 'export function f() { return useState(0); }'].join('\n');
    const out = injectReactHookImports(code, deps);
    expect(out).toBe(
      ['// @kern-source: x:1', "import { useState } from 'react';", 'export function f() { return useState(0); }'].join('\n'),
    );
  });

  test('merges into existing named-only react import', () => {
    const code = ["import { useEffect } from 'react';", 'export function f() { return useState(0); }'].join('\n');
    const out = injectReactHookImports(code, deps);
    expect(out).toBe(
      ["import { useEffect, useState } from 'react';", 'export function f() { return useState(0); }'].join('\n'),
    );
  });

  test('merges into existing default+named react import', () => {
    const code = ["import React, { useEffect } from 'react';", 'export function f() {}'].join('\n');
    const out = injectReactHookImports(code, deps);
    expect(out).toBe(
      ["import React, { useEffect, useState } from 'react';", 'export function f() {}'].join('\n'),
    );
  });

  test('no-op when useState already imported', () => {
    const code = ["import { useState } from 'react';", 'export function f() {}'].join('\n');
    expect(injectReactHookImports(code, deps)).toBe(code);
  });

  test('no-op when deps is empty', () => {
    const code = 'export function f() {}';
    expect(injectReactHookImports(code, new Set())).toBe(code);
  });

  test('respects use-client directive — import lands after, not before', () => {
    const code = ["'use client';", 'export function f() { return useState(0); }'].join('\n');
    const out = injectReactHookImports(code, deps);
    expect(out).toBe(
      ["'use client';", "import { useState } from 'react';", 'export function f() { return useState(0); }'].join('\n'),
    );
  });

  test('respects hashbang on line 1', () => {
    const code = ['#!/usr/bin/env node', 'export function f() {}'].join('\n');
    const out = injectReactHookImports(code, deps);
    expect(out).toBe(['#!/usr/bin/env node', "import { useState } from 'react';", 'export function f() {}'].join('\n'));
  });

  test('Codex P2: multiple react imports — no-op when useState already in second line', () => {
    // Codex's review found this: with multiple `from 'react'` imports
    // (e.g. produced by an `extern react` block with several child
    // `import names=...` lines), v4's first-match-only merge would add
    // `useState` to import #1 even when import #2 already had it,
    // producing a TS2300 duplicate identifier.
    const code = [
      "import { useEffect } from 'react';",
      "import { useState } from 'react';",
      'export function f() { return useState(0); }',
    ].join('\n');
    expect(injectReactHookImports(code, deps)).toBe(code);
  });

  test('Codex P2: multiple react imports — merges into first when no line has the name', () => {
    const code = [
      "import { useEffect } from 'react';",
      "import { useMemo } from 'react';",
      'export function f() { return useState(0); }',
    ].join('\n');
    const out = injectReactHookImports(code, deps);
    expect(out).toBe(
      [
        "import { useEffect, useState } from 'react';",
        "import { useMemo } from 'react';",
        'export function f() { return useState(0); }',
      ].join('\n'),
    );
  });
});
