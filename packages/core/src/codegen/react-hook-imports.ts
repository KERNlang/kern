/** Slice C-cell-v4 — auto-emit React hook imports for body-statement cells.
 *
 *  Slice C-cell-v3 (commit 1ce4953) shipped the native `cell` body-stmt that
 *  lowers to `const [name, setName] = useState<T>(initial);`. The codegen
 *  emits the call but NOT the `import { useState } from 'react'` — that has
 *  always been author-emitted via file-level KERN `import` / `extern` nodes.
 *
 *  Authoring a `cell`-using `fn` from scratch (no surrounding `screen` to
 *  carry a hand-written react import) produced TS with `useState` references
 *  but no import — a tsc/tsx-time error. This module closes that gap with
 *  the same architecture as `stdlib-preamble.ts` for `Result` / `Option`:
 *
 *    1. `detectReactHookDeps(root)` — walk IR for body-stmt cell usage and
 *       return the set of React hook names the generated TS will reference.
 *       (Only `useState` today; `useEffect` / `useMemo` / `useCallback` etc.
 *       will land when their corresponding body-stmt forms ship.)
 *
 *    2. `injectReactHookImports(code, deps)` — merge the required names into
 *       any existing `from 'react'` import in the generated TS, or insert a
 *       new line after the prologue (hashbang, directives, comments) so it
 *       lands above other imports without disturbing line-1-required content.
 *
 *  Why a separate module from `stdlib-preamble.ts`: hook imports are package
 *  imports (`from 'react'`), not type-alias preambles. Merging with existing
 *  imports requires fundamentally different inject logic than prepending
 *  helper definitions. Keeping the concerns split also keeps the React-hook
 *  scan from triggering on `Result` / `Option` typed handler params (which
 *  the stdlib walker is tuned for). */

import type { IRNode } from '../types.js';

/** Set of React hook names that the generated TS will reference and that
 *  need to be in scope. Grows in lockstep with body-statement nodes that
 *  lower to React hooks. */
export type ReactHookDep = 'useState';

/** Walk the IR for body-statement nodes that lower to React hooks. Returns
 *  the set of hook names that the generated TS will reference. Empty set
 *  means no injection needed.
 *
 *  Current scope (slice C-cell-v4): only `cell` → `useState`. Top-level
 *  `state` nodes inside `screen` also lower to `useState`, but those have
 *  always been served by author-emitted file-level react imports — this
 *  walker stays narrow to avoid double-emission with hand-written imports
 *  that already cover the screen case. */
export function detectReactHookDeps(root: IRNode): Set<ReactHookDep> {
  const deps = new Set<ReactHookDep>();
  walk(root, deps);
  return deps;
}

function walk(node: IRNode, deps: Set<ReactHookDep>): void {
  if (node.type === 'cell') deps.add('useState');
  if (node.children) {
    for (const child of node.children) walk(child, deps);
  }
}

/** Smart-merge the required React hook imports into a finished TS module.
 *
 *  Three cases:
 *    1. Generated TS already imports the required names from 'react' — no-op.
 *    2. Generated TS has a `from 'react'` import missing some names — merge
 *       missing names into the existing import's named list, preserving the
 *       default import + ordering of existing names.
 *    3. No `from 'react'` import present — insert a new line after the
 *       module prologue (hashbang, directives, leading comments) so the
 *       directive `'use client'` (Next.js / RSC) stays on the file's first
 *       non-comment line.
 *
 *  The function is conservative: it only matches single-line react imports
 *  with a default and/or named list. Multi-line `import { a,\n b } from
 *  'react';` is not merged (rare in generated code; treated as case 3 and
 *  a duplicate line is emitted — TS allows it but it's ugly). */
export function injectReactHookImports(code: string, deps: Set<ReactHookDep>): string {
  if (deps.size === 0) return code;
  const required = [...deps];

  const reactImportRe = /^(\s*)import\s+(?:(?:(\w+)\s*,\s*)?\{\s*([^}]*)\s*\}|(\w+))\s+from\s+(['"])react\5\s*;?\s*$/m;
  const match = code.match(reactImportRe);
  if (match) {
    const [fullLine, indent, namedDefault, existingNames, bareDefault, quote] = match;
    const defaultImport = namedDefault ?? bareDefault ?? '';
    const existing = (existingNames ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const missing = required.filter((n) => !existing.includes(n));
    if (missing.length === 0) return code;
    const mergedNames = [...existing, ...missing].join(', ');
    const defaultPart = defaultImport ? `${defaultImport}, ` : '';
    const merged = `${indent}import ${defaultPart}{ ${mergedNames} } from ${quote}react${quote};`;
    return code.replace(fullLine, merged);
  }

  const insertLine = `import { ${required.join(', ')} } from 'react';`;
  return injectAfterPrologue(code, insertLine);
}

function injectAfterPrologue(code: string, line: string): string {
  if (code.length === 0) return line;
  const lines = code.split('\n');
  let i = 0;
  let inBlockComment = false;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      i++;
      continue;
    }
    if (trimmed === '') {
      i++;
      continue;
    }
    if (i === 0 && trimmed.startsWith('#!')) {
      i++;
      continue;
    }
    if (trimmed.startsWith('//')) {
      i++;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      i++;
      continue;
    }
    if (DIRECTIVE_RE.test(raw)) {
      i++;
      continue;
    }
    break;
  }
  if (i === 0) return [line, ...lines].join('\n');
  return [...lines.slice(0, i), line, ...lines.slice(i)].join('\n');
}

const DIRECTIVE_RE = /^\s*['"]use [a-z]+['"];?\s*(?:\/\/.*|\/\*[\s\S]*?\*\/)?\s*$/;
