/** Implicit `lang="kern"` on handlers — boilerplate-removal canonicalizer.
 *
 *  Pre-change: every native handler required `lang="kern"` boilerplate or
 *  parsing failed with BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER. The
 *  canonicalizeImplicitKernHandlerLang step (parser-core.ts) now infers
 *  `lang="kern"` when a handler has body-statement children and no explicit
 *  lang or raw `<<<...>>>` block. These tests cover the inference rule and
 *  guard the backward-compat boundaries:
 *    - explicit `lang="kern"` still works
 *    - explicit `lang="ts"` / `lang="python"` still treated as foreign
 *    - raw `<<<...>>>` handlers untouched
 *    - the `on event=… → set …` event-handler shortcut untouched
 */

import { parseDocumentWithDiagnostics } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function findHandler(root: IRNode): IRNode | null {
  if (root.type === 'handler') return root;
  for (const child of root.children ?? []) {
    const hit = findHandler(child);
    if (hit) return hit;
  }
  return null;
}

function findNode(root: IRNode, type: string): IRNode | null {
  if (root.type === type) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, type);
    if (hit) return hit;
  }
  return null;
}

describe('canonicalizeImplicitKernHandlerLang — inference', () => {
  test('handler with `return` child has lang="kern" inferred', () => {
    const src = ['fn name=greet returns=string', '  handler', '    return value="\\"hi\\""'].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const handler = findHandler(root);
    expect(handler).not.toBeNull();
    expect(handler?.props?.lang).toBe('kern');
  });

  test('handler with `let` + `assign` children has lang="kern" inferred', () => {
    const src = [
      'fn name=tick returns=number',
      '  handler',
      '    let name=n value="0"',
      '    assign target="n" op="++"',
      '    return value="n"',
    ].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const handler = findHandler(root);
    expect(handler?.props?.lang).toBe('kern');
  });

  test('handler with `each` body-stmt child has lang="kern" inferred', () => {
    const src = ['fn name=run returns=void', '  handler', '    each name=x in=xs', '      do value="process(x)"'].join(
      '\n',
    );
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(findHandler(root)?.props?.lang).toBe('kern');
  });

  test('inference removes the previous BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER error', () => {
    // Before the canonicalizer, this exact source emitted
    // BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER on the bare `return` because the
    // handler had no `lang="kern"`. Now it parses clean.
    const src = ['fn name=ok returns=string', '  handler', '    return value="\\"ok\\""'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const offenders = diagnostics.filter(
      (d) => d.severity === 'error' && d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER',
    );
    expect(offenders).toHaveLength(0);
  });
});

describe('canonicalizeImplicitKernHandlerLang — backward compatibility', () => {
  test('explicit lang="kern" is preserved (still works exactly as before)', () => {
    const src = ['fn name=ok returns=string', '  handler lang="kern"', '    return value="\\"ok\\""'].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(findHandler(root)?.props?.lang).toBe('kern');
  });

  test('explicit lang="ts" is left alone (foreign boundary preserved)', () => {
    const src = ['fn name=ok returns=string', '  handler lang="ts" <<<', '  return "ok";', '  >>>'].join('\n');
    const { root } = parseDocumentWithDiagnostics(src);
    const handler = findHandler(root);
    expect(handler?.props?.lang).toBe('ts');
  });

  test('raw <<<...>>> handler (no lang) is left alone — no body-stmt children to trigger inference', () => {
    const src = ['fn name=ok returns=string', '  handler <<<', '  return "ok";', '  >>>'].join('\n');
    const { root } = parseDocumentWithDiagnostics(src);
    const handler = findHandler(root);
    // No body-stmt children → no inference; lang stays unset.
    expect(handler?.props?.lang).toBeUndefined();
  });

  test('on event=… → set name=… shortcut is untouched (set is direct child of `on`, not handler)', () => {
    const src = [
      'screen name=Counter',
      '  handler lang="kern"',
      '    cell name=count value="0"',
      '  button label="+1"',
      '    on event=click',
      '      set name=count to="count + 1"',
    ].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    // Confirm structure: the `set` is parented by `on`, not by a synthetic
    // handler — the canonicalizer must not have mistakenly wrapped it.
    const onNode = findNode(root, 'on');
    expect(onNode).not.toBeNull();
    expect(onNode?.children?.[0]?.type).toBe('set');
  });
});

describe('canonicalizeImplicitKernHandlerLang — discriminator guards', () => {
  test('handler with only `comment` child does NOT get lang inferred (comment is universal)', () => {
    const src = ['fn name=stub returns=void', '  handler', '    comment text="todo"'].join('\n');
    const { root } = parseDocumentWithDiagnostics(src);
    // No body-stmt signal, so lang should stay unset — an empty foreign stub
    // documented with a comment must not silently flip to KERN-native.
    expect(findHandler(root)?.props?.lang).toBeUndefined();
  });

  test('async-orchestration `try name="…"` child does NOT trigger inference (only body-stmt try with no name does)', () => {
    const src = [
      'fn name=run returns=void',
      '  handler',
      '    try name=fetchUser',
      '      step name=user expr="await getUser()"',
    ].join('\n');
    const { root } = parseDocumentWithDiagnostics(src);
    // `try name=…` is async-orchestration form, not body-stmt — inference must skip it.
    expect(findHandler(root)?.props?.lang).toBeUndefined();
  });

  test('explicit lang="ts" with body-stmt children still errors (foreign boundary not overridden)', () => {
    const src = ['fn name=bad returns=string', '  handler lang="ts"', '    return value="\\"x\\""'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const offenders = diagnostics.filter(
      (d) => d.severity === 'error' && d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER',
    );
    // Author explicitly opted into foreign lang; body-stmt must still be rejected.
    expect(offenders.length).toBeGreaterThan(0);
  });

  test('explicit lang="python" is left alone (parity with the lang="ts" path)', () => {
    const src = ['fn name=ok returns=string', '  handler lang="python" <<<', '  return "ok"', '  >>>'].join('\n');
    const { root } = parseDocumentWithDiagnostics(src);
    expect(findHandler(root)?.props?.lang).toBe('python');
  });

  test('body-stmt `if cond="…"` inside a handler triggers inference (cond= is the body-stmt discriminator)', () => {
    const src = ['fn name=ok returns=string', '  handler', '    if cond="x"', '      return value="\\"a\\""'].join(
      '\n',
    );
    const { root } = parseDocumentWithDiagnostics(src);
    expect(findHandler(root)?.props?.lang).toBe('kern');
  });

  test('render-side `conditional` with `if=` prop does NOT spawn an inferred handler (the prop is on `conditional`, not a body-stmt `if` node)', () => {
    // `conditional` is the render-level branch; it carries `if=` as a PROP,
    // not as a body-stmt `if` node. There is no handler in this fragment,
    // so the canonicalizer must not synthesise one or stamp lang anywhere.
    const src = [
      'screen name=Greeting',
      '  conditional if="show"',
      '    text value="\\"hello\\""',
      '  else',
      '    text value="\\"bye\\""',
    ].join('\n');
    const { root } = parseDocumentWithDiagnostics(src);
    expect(findHandler(root)).toBeNull();
  });

  test('empty `lang=""` is treated as no-explicit-lang and is allowed to infer to kern (matches schema.ts:3170 coercion)', () => {
    const src = ['fn name=ok returns=string', '  handler lang=""', '    return value="\\"ok\\""'].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(findHandler(root)?.props?.lang).toBe('kern');
  });

  test('body-stmt `try` (no name) triggers inference — paired with the negative async-try-name test above', () => {
    const src = [
      'fn name=ok returns=void',
      '  handler',
      '    try',
      '      do value="work()"',
      '    catch',
      '      do value="handle()"',
    ].join('\n');
    const { root, diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(findHandler(root)?.props?.lang).toBe('kern');
  });
});
