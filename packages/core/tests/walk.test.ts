/**
 * Tests for the IRNode tree walker.
 */

import { getNodeAtPosition, walkIR } from '../src/walk.js';

/** Helper to build IR nodes concisely. */
function ir(type: string, props?: Record<string, unknown>, children?: any[]): any {
  return { type, ...(props ? { props } : {}), ...(children?.length ? { children } : {}) };
}

// ── Test tree ────────────────────────────────────────────────────────────
//
//  screen (depth 0)
//  ├─ box (depth 1)
//  │  ├─ text (depth 2)
//  │  └─ button (depth 2)
//  └─ text (depth 1)
//
const tree = () =>
  ir('screen', { name: 'Home' }, [
    ir('box', undefined, [ir('text', { value: 'hello' }), ir('button', { label: 'click' })]),
    ir('text', { value: 'footer' }),
  ]);

describe('walkIR', () => {
  // 1. Pre-order traversal collects all nodes in correct order
  it('visits nodes in pre-order (depth-first)', () => {
    const visited: string[] = [];
    walkIR(tree(), {
      '*': (node) => {
        visited.push(node.type);
      },
    });
    expect(visited).toEqual(['screen', 'box', 'text', 'button', 'text']);
  });

  // 2. Type-specific visitors only fire for matching types
  it('type-specific visitors only fire for matching types', () => {
    const visited: string[] = [];
    walkIR(tree(), {
      button: (node) => {
        visited.push(node.type);
      },
    });
    expect(visited).toEqual(['button']);
  });

  // 3. Wildcard '*' visitor fires for all nodes
  it('wildcard visitor fires for every node', () => {
    const visited: string[] = [];
    walkIR(tree(), {
      '*': (node) => {
        visited.push(node.type);
      },
    });
    expect(visited).toHaveLength(5);
  });

  // 4. ctx.skip() prevents visiting children
  it('ctx.skip() prevents visiting children', () => {
    const visited: string[] = [];
    walkIR(tree(), {
      '*': (node, ctx) => {
        visited.push(node.type);
        if (node.type === 'box') ctx.skip();
      },
    });
    // box's children (text, button) should be skipped; sibling text still visited
    expect(visited).toEqual(['screen', 'box', 'text']);
  });

  // 5. ctx.stop() halts traversal entirely
  it('ctx.stop() halts traversal', () => {
    const visited: string[] = [];
    walkIR(tree(), {
      '*': (node, ctx) => {
        visited.push(node.type);
        if (node.type === 'box') ctx.stop();
      },
    });
    expect(visited).toEqual(['screen', 'box']);
  });

  // 6. Leave callbacks fire in post-order
  it('leave callbacks fire in post-order', () => {
    const order: string[] = [];
    walkIR(tree(), {
      '*': {
        leave: (node) => {
          order.push(node.type);
        },
      },
    });
    // Post-order: deepest leaves first, root last
    expect(order).toEqual(['text', 'button', 'box', 'text', 'screen']);
  });

  // 7. ctx.parent and ctx.depth are correct
  it('provides correct parent and depth', () => {
    const entries: Array<{ type: string; parentType: string | undefined; depth: number }> = [];
    walkIR(tree(), {
      '*': (node, ctx) => {
        entries.push({
          type: node.type,
          parentType: ctx.parent?.type,
          depth: ctx.depth,
        });
      },
    });
    expect(entries).toEqual([
      { type: 'screen', parentType: undefined, depth: 0 },
      { type: 'box', parentType: 'screen', depth: 1 },
      { type: 'text', parentType: 'box', depth: 2 },
      { type: 'button', parentType: 'box', depth: 2 },
      { type: 'text', parentType: 'screen', depth: 1 },
    ]);
  });

  // 8. Empty tree / node with no children works
  it('handles a leaf node with no children', () => {
    const visited: string[] = [];
    walkIR(ir('leaf'), {
      '*': (node) => {
        visited.push(node.type);
      },
    });
    expect(visited).toEqual(['leaf']);
  });

  it('handles a node with an empty children array', () => {
    const node = { type: 'empty', children: [] as any[] };
    const visited: string[] = [];
    walkIR(node, {
      '*': (n) => {
        visited.push(n.type);
      },
    });
    expect(visited).toEqual(['empty']);
  });

  // 9. Combined type + wildcard visitors both fire
  it('fires both type-specific and wildcard visitors', () => {
    const log: string[] = [];
    walkIR(ir('root', undefined, [ir('child')]), {
      child: (node) => {
        log.push(`type:${node.type}`);
      },
      '*': (node) => {
        log.push(`wild:${node.type}`);
      },
    });
    // For root: only wildcard (no type visitor). For child: type first, then wildcard.
    expect(log).toEqual(['wild:root', 'type:child', 'wild:child']);
  });

  // Extra: enter + leave ordering together
  it('enter and leave fire in correct order', () => {
    const log: string[] = [];
    walkIR(ir('a', undefined, [ir('b')]), {
      '*': {
        enter: (node) => {
          log.push(`enter:${node.type}`);
        },
        leave: (node) => {
          log.push(`leave:${node.type}`);
        },
      },
    });
    expect(log).toEqual(['enter:a', 'enter:b', 'leave:b', 'leave:a']);
  });

  // Extra: stop() in enter prevents leave from firing for remaining nodes
  it('stop() in enter prevents further leave callbacks', () => {
    const log: string[] = [];
    walkIR(ir('a', undefined, [ir('b'), ir('c')]), {
      '*': {
        enter: (node, ctx) => {
          log.push(`enter:${node.type}`);
          if (node.type === 'b') ctx.stop();
        },
        leave: (node) => {
          log.push(`leave:${node.type}`);
        },
      },
    });
    // a enters, b enters and stops — no leaves fire after stop
    expect(log).toEqual(['enter:a', 'enter:b']);
  });

  // Extra: skip() still allows leave to fire
  it('skip() still fires leave for the skipped node', () => {
    const log: string[] = [];
    walkIR(ir('a', undefined, [ir('b', undefined, [ir('c')])]), {
      '*': {
        enter: (node, ctx) => {
          log.push(`enter:${node.type}`);
          if (node.type === 'b') ctx.skip();
        },
        leave: (node) => {
          log.push(`leave:${node.type}`);
        },
      },
    });
    // b is entered and leave fires, but child c is never visited
    expect(log).toEqual(['enter:a', 'enter:b', 'leave:b', 'leave:a']);
  });
});

// ── getNodeAtPosition ─────────────────────────────────────────────────────

describe('getNodeAtPosition', () => {
  function irLoc(type: string, line: number, col: number, endLine: number, endCol: number, children?: any[]): any {
    return { type, loc: { line, col, endLine, endCol }, ...(children?.length ? { children } : {}) };
  }

  const locTree = () => irLoc('page', 1, 1, 5, 1, [irLoc('box', 2, 3, 4, 20, [irLoc('text', 3, 5, 3, 25)])]);

  it('returns deepest node at position', () => {
    const node = getNodeAtPosition(locTree(), 3, 10);
    expect(node?.type).toBe('text');
  });

  it('returns parent when position is outside child but inside parent', () => {
    const node = getNodeAtPosition(locTree(), 2, 3);
    expect(node?.type).toBe('box');
  });

  it('returns root for position at line 1', () => {
    const node = getNodeAtPosition(locTree(), 1, 1);
    expect(node?.type).toBe('page');
  });

  it('returns undefined for position outside all nodes', () => {
    const node = getNodeAtPosition(locTree(), 10, 1);
    expect(node).toBeUndefined();
  });

  it('returns undefined when nodes have no loc', () => {
    const node = getNodeAtPosition(ir('page', undefined, [ir('text')]), 1, 1);
    expect(node).toBeUndefined();
  });
});
