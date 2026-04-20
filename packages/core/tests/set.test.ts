/**
 * Tests for the `set` node — declarative state update inside `on` event
 * blocks. `set name=count to="count + 1"` lowers to `setCount(count + 1);`,
 * using the same useState setter convention as `emitStateDecls`.
 *
 * Added in PR 5 to close the "React hooks integration" gap — authors no
 * longer need a handler block just to call a setter.
 */

import { generateCoreNode, generateOn } from '../src/codegen-core.js';
import { KernCodegenError } from '../src/errors.js';
import { parse } from '../src/parser.js';
import { validateSemantics } from '../src/semantic-validator.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('set inside `on` event', () => {
  it('lowers a single `set` into a setter call in the callback body', () => {
    const onNode = mk('on', { event: 'click' }, [mk('set', { name: 'count', to: 'count + 1' })]);
    const code = generateOn(onNode).join('\n');

    expect(code).toContain('function handleClick(e: MouseEvent) {');
    expect(code).toContain('setCount(count + 1);');
    // No residual handler block should appear when none was authored.
    expect(code).not.toContain('handler');
  });

  it('emits multiple setters in source order', () => {
    const onNode = mk('on', { event: 'click' }, [
      mk('set', { name: 'count', to: 'count + 1' }),
      mk('set', { name: 'lastClickAt', to: 'Date.now()' }),
    ]);
    const code = generateOn(onNode).join('\n');

    const firstSet = code.indexOf('setCount(count + 1);');
    const secondSet = code.indexOf('setLastClickAt(Date.now());');
    expect(firstSet).toBeGreaterThan(-1);
    expect(secondSet).toBeGreaterThan(firstSet);
  });

  it('inlines set calls before handler code when both are present', () => {
    const onNode = mk('on', { event: 'click' }, [
      mk('set', { name: 'count', to: 'count + 1' }),
      mk('handler', { code: 'logClick(e);' }),
    ]);
    const code = generateOn(onNode).join('\n');

    const setLine = code.indexOf('setCount(count + 1);');
    const logLine = code.indexOf('logClick(e);');
    expect(setLine).toBeGreaterThan(-1);
    expect(logLine).toBeGreaterThan(setLine);
  });

  it('places a handler before later set calls when source order says so', () => {
    const onNode = mk('on', { event: 'click' }, [
      mk('handler', { code: 'prepare(e);' }),
      mk('set', { name: 'ready', to: 'true' }),
    ]);
    const code = generateOn(onNode).join('\n');

    const prep = code.indexOf('prepare(e);');
    const setCall = code.indexOf('setReady(true);');
    expect(prep).toBeGreaterThan(-1);
    expect(setCall).toBeGreaterThan(prep);
  });

  it('respects the key= guard when `set` is the only body', () => {
    const onNode = mk('on', { event: 'keydown', key: 'Enter' }, [mk('set', { name: 'open', to: 'false' })]);
    const code = generateOn(onNode).join('\n');

    expect(code).toContain("if (key !== 'Enter') return;");
    expect(code).toContain('setOpen(false);');
  });

  it('capitalises multi-char state names correctly (userName → setUserName)', () => {
    const onNode = mk('on', { event: 'change' }, [mk('set', { name: 'userName', to: 'e.target.value' })]);
    const code = generateOn(onNode).join('\n');
    expect(code).toContain('setUserName(e.target.value);');
  });

  it('throws when the `to` prop is missing', () => {
    const onNode = mk('on', { event: 'click' }, [mk('set', { name: 'count' })]);
    expect(() => generateOn(onNode)).toThrow(KernCodegenError);
    expect(() => generateOn(onNode)).toThrow(/to/);
  });

  it('throws when the `name` is not a valid identifier', () => {
    const onNode = mk('on', { event: 'click' }, [mk('set', { name: 'bad-name!', to: '1' })]);
    expect(() => generateOn(onNode)).toThrow(KernCodegenError);
  });

  it('back-compat: on-with-handler-only still emits the exact pre-PR-5 body shape', () => {
    const onNode = mk('on', { event: 'click' }, [mk('handler', { code: 'doStuff();' })]);
    const code = generateOn(onNode).join('\n');
    expect(code).toContain('function handleClick(e: MouseEvent) {');
    expect(code).toContain('doStuff();');
  });
});

describe('set — semantic validation (set-requires-matching-state)', () => {
  it('flags a `set` whose target has no matching `state` ancestor', () => {
    const screen = mk('screen', { name: 'Counter', target: 'ink' }, [
      mk('state', { name: 'other', type: 'number', initial: '0' }),
      mk('render', {}, [
        mk('handler', { code: '<Text>{other}</Text>' }),
        mk('on', { event: 'click' }, [mk('set', { name: 'count', to: 'count + 1' })]),
      ]),
    ]);
    const violations = validateSemantics(screen);
    const hits = violations.filter((v) => v.rule === 'set-requires-matching-state');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('set name=count');
    expect(hits[0].message).toContain('Available in scope: other');
  });

  it('does NOT flag a `set` that matches a sibling `state` on the enclosing screen', () => {
    const screen = mk('screen', { name: 'Counter', target: 'ink' }, [
      mk('state', { name: 'count', type: 'number', initial: '0' }),
      mk('on', { event: 'click' }, [mk('set', { name: 'count', to: 'count + 1' })]),
    ]);
    const violations = validateSemantics(screen);
    expect(violations.filter((v) => v.rule === 'set-requires-matching-state')).toHaveLength(0);
  });

  it('reports "No state declarations in scope" when there are none at all', () => {
    const root = mk('screen', { name: 'Empty', target: 'ink' }, [
      mk('on', { event: 'click' }, [mk('set', { name: 'x', to: '1' })]),
    ]);
    const violations = validateSemantics(root);
    const hits = violations.filter((v) => v.rule === 'set-requires-matching-state');
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('No `state` declarations found');
  });

  it('walks multiple ancestor levels to find the matching state', () => {
    // set is nested two levels deep — still finds `state` on the screen.
    const screen = mk('screen', { name: 'Nested', target: 'ink' }, [
      mk('state', { name: 'open', type: 'boolean', initial: 'false' }),
      mk('render', {}, [
        mk('conditional', { if: 'true' }, [
          mk('handler', { code: '<Button />' }),
          mk('on', { event: 'click' }, [mk('set', { name: 'open', to: 'true' })]),
        ]),
      ]),
    ]);
    const violations = validateSemantics(screen);
    expect(violations.filter((v) => v.rule === 'set-requires-matching-state')).toHaveLength(0);
  });
});

describe('set — full parse pipeline', () => {
  const source = [
    'on event=click',
    '  set name=count to="count + 1"',
    '  set name=lastClickAt to="Date.now()"',
    '',
  ].join('\n');

  it('parses and emits chained setters inside the generated callback', () => {
    const ast = parse(source);
    const onNode = ast.type === 'on' ? ast : ast.children?.find((c) => c.type === 'on');
    expect(onNode).toBeDefined();
    const sets = (onNode as IRNode).children?.filter((c) => c.type === 'set') || [];
    expect(sets).toHaveLength(2);

    const code = generateCoreNode(onNode as IRNode).join('\n');
    expect(code).toContain('setCount(count + 1);');
    expect(code).toContain('setLastClickAt(Date.now());');
  });
});
