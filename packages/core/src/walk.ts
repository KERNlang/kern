/**
 * Tree walker for IRNode — ESLint-style type-keyed visitors with flow control.
 */

import type { IRNode } from './types.js';

// ── Public types ─────────────────────────────────────────────────────────

export interface WalkContext {
  /** Skip visiting children of the current node */
  skip(): void;
  /** Stop the entire traversal */
  stop(): void;
  /** The parent node, if any */
  parent: IRNode | undefined;
  /** Depth from root (0 = root) */
  depth: number;
}

/** Visitor callback function */
export type VisitorFn = (node: IRNode, ctx: WalkContext) => void;

/** A visitor can be a function (enter only) or { enter?, leave? } */
export type Visitor = VisitorFn | { enter?: VisitorFn; leave?: VisitorFn };

/** Visitor map keyed by node type, plus optional '*' wildcard */
export type VisitorMap = Record<string, Visitor>;

// ── Helpers ──────────────────────────────────────────────────────────────

function getEnter(v: Visitor | undefined): VisitorFn | undefined {
  if (!v) return undefined;
  return typeof v === 'function' ? v : v.enter;
}

function getLeave(v: Visitor | undefined): VisitorFn | undefined {
  if (!v) return undefined;
  return typeof v === 'function' ? undefined : v.leave;
}

// ── Walk ─────────────────────────────────────────────────────────────────

/**
 * Walk an IR tree depth-first, calling visitors for matching node types.
 * Supports type-keyed visitors and a '*' wildcard.
 */
export function walkIR(root: IRNode, visitors: VisitorMap): void {
  let stopped = false;

  function visit(node: IRNode, parent: IRNode | undefined, depth: number): void {
    if (stopped) return;

    let skipped = false;

    const ctx: WalkContext = {
      skip() {
        skipped = true;
      },
      stop() {
        stopped = true;
      },
      parent,
      depth,
    };

    // ── Enter: type-specific first, then wildcard ──
    const typeVisitor = visitors[node.type];
    const wildcard = visitors['*'];

    const typeEnter = getEnter(typeVisitor);
    if (typeEnter) {
      typeEnter(node, ctx);
      if (stopped) return;
    }

    const wildcardEnter = getEnter(wildcard);
    if (wildcardEnter) {
      wildcardEnter(node, ctx);
      if (stopped) return;
    }

    // ── Recurse into children (unless skipped) ──
    if (!skipped && node.children) {
      for (const child of node.children) {
        visit(child, node, depth + 1);
        if (stopped) return;
      }
    }

    // ── Leave: type-specific first, then wildcard ──
    const typeLeave = getLeave(typeVisitor);
    if (typeLeave) {
      typeLeave(node, ctx);
      if (stopped) return;
    }

    const wildcardLeave = getLeave(wildcard);
    if (wildcardLeave) {
      wildcardLeave(node, ctx);
    }
  }

  visit(root, undefined, 0);
}

/**
 * Find the deepest IR node whose source location contains the given position.
 *
 * Essential for LSP hover, completion, and go-to-definition.
 * Requires nodes to have `loc` with `endLine`/`endCol` for accurate results.
 *
 * @param root - The root IR node to search
 * @param line - 1-based line number
 * @param col - 1-based column number
 * @returns The deepest matching node, or `undefined` if no node spans the position
 */
export function getNodeAtPosition(root: IRNode, line: number, col: number): IRNode | undefined {
  let best: IRNode | undefined;

  walkIR(root, {
    '*': (node, ctx) => {
      const loc = node.loc;
      if (!loc) return;

      const startLine = loc.line;
      const startCol = loc.col;
      const endLine = loc.endLine ?? startLine;
      const endCol = loc.endCol ?? startCol;

      // Check if position falls within this node's span
      const afterStart = line > startLine || (line === startLine && col >= startCol);
      const beforeEnd = line < endLine || (line === endLine && col <= endCol);

      if (afterStart && beforeEnd) {
        // Deeper nodes overwrite shallower — walkIR visits pre-order,
        // so children that match will be assigned after their parent
        best = node;
      } else {
        // Position is outside this node — skip all children
        ctx.skip();
      }
    },
  });

  return best;
}
