/**
 * set-setter-collision — warns when a class `setter name=X` and a React
 * state `state name=X` appear in the same file.
 *
 * Why this rule exists:
 *   KERN has two nearby-but-different primitives that an LLM author can
 *   reach for by accident:
 *     - `setter name=X params="v:T"` inside a `class` → emits the JS
 *       object-style accessor `set X(v: T) { body }`.
 *     - `set name=X` inside an `on` handler → emits the React hook call
 *       `setX(value)`, which requires a sibling `state name=X`.
 *   When both appear in the same file with the same name, the reader loses
 *   track of which spelling is the right one for the current site. The rule
 *   fires `warning` on each offending node so the author can either rename
 *   one of them or consciously accept the overlap.
 *
 * Scope: this is a .kern-source lint rule (ships with `reviewKernSource`).
 * Layer: `kern-source`, severity `warning`, precision `high`.
 */

import type { IRNode } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import type { KernSourceRule } from './kern-source.js';
import { finding } from './utils.js';

function getName(node: IRNode): string | undefined {
  const n = node.props?.name;
  return typeof n === 'string' ? n : undefined;
}

function collectByType(
  nodes: IRNode[],
  types: Set<string>,
  acc: Map<string, IRNode[]> = new Map(),
): Map<string, IRNode[]> {
  for (const node of nodes) {
    if (types.has(node.type)) {
      const n = getName(node);
      if (n) {
        const arr = acc.get(n) ?? [];
        arr.push(node);
        acc.set(n, arr);
      }
    }
    if (node.children) collectByType(node.children, types, acc);
  }
  return acc;
}

const SETTER_TYPES = new Set(['setter']);
const STATE_TYPES = new Set(['state']);

export const setSetterCollision: KernSourceRule = (nodes: IRNode[], filePath: string): ReviewFinding[] => {
  const setters = collectByType(nodes, SETTER_TYPES);
  if (setters.size === 0) return [];
  const states = collectByType(nodes, STATE_TYPES);
  if (states.size === 0) return [];

  const findings: ReviewFinding[] = [];
  for (const [name, setterNodes] of setters) {
    const stateNodes = states.get(name);
    if (!stateNodes || stateNodes.length === 0) continue;

    const message =
      `\`setter name=${name}\` and \`state name=${name}\` both declared in this file — ` +
      'the class emits `set ' +
      name +
      '(v)` while the state emits `set' +
      name[0].toUpperCase() +
      name.slice(1) +
      '(v)`. Rename one side or document the overlap.';

    for (const setterNode of setterNodes) {
      findings.push(
        finding(
          'set-setter-name-collision',
          'warning',
          'pattern',
          message,
          filePath,
          setterNode.loc?.line ?? 1,
          setterNode.loc?.col ?? 1,
          {
            suggestion:
              '`setter` defines a JS object accessor (`set X(v)`); `set` inside an `on` handler calls the React setter (`setX(v)`). Pick the spelling that matches author intent and rename the other.',
          },
        ),
      );
    }
    for (const stateNode of stateNodes) {
      findings.push(
        finding(
          'set-setter-name-collision',
          'warning',
          'pattern',
          message,
          filePath,
          stateNode.loc?.line ?? 1,
          stateNode.loc?.col ?? 1,
          {
            suggestion:
              '`setter` defines a JS object accessor (`set X(v)`); `set` inside an `on` handler calls the React setter (`setX(v)`). Pick the spelling that matches author intent and rename the other.',
          },
        ),
      );
    }
  }

  return findings;
};
