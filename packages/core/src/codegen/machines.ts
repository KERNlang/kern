/**
 * State Machine Generators — machine, machineReducer.
 *
 * KERN's killer feature: 12 lines of KERN → 140+ lines of TypeScript.
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import type { IRNode } from '../types.js';
import { emitIdentifier, emitTemplateSafe } from './emitters.js';
import { getProps, getChildren, handlerCode, exportPrefix } from './helpers.js';

const p = getProps;
const kids = getChildren;

// ── State Machine ────────────────────────────────────────────────────────

export function generateMachine(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownMachine', node);
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Collect states
  const states = kids(node, 'state');
  const stateNames = states.map(s => {
    const sp = p(s);
    return emitIdentifier((sp.name || sp.value) as string, 'state', s);
  });

  // State type
  const stateType = `${name}State`;
  lines.push(`${exp}type ${stateType} = ${stateNames.map(s => `'${emitTemplateSafe(s)}'`).join(' | ')};`);
  lines.push('');

  // Error class
  const errorName = `${name}StateError`;
  lines.push(`${exp}class ${errorName} extends Error {`);
  lines.push(`  constructor(`);
  lines.push(`    public readonly expected: string | string[],`);
  lines.push(`    public readonly actual: string,`);
  lines.push(`  ) {`);
  lines.push(`    const expectedStr = Array.isArray(expected) ? expected.join(' | ') : expected;`);
  lines.push(`    super(\`Invalid ${name.toLowerCase()} state: expected \${expectedStr}, got \${actual}\`);`);
  lines.push(`    this.name = '${errorName}';`);
  lines.push(`  }`);
  lines.push('}');
  lines.push('');

  // Transition functions
  const transitions = kids(node, 'transition');
  for (const t of transitions) {
    const tp = p(t);
    const tname = emitIdentifier(tp.name as string, 'transition', t);
    const from = tp.from as string;
    const to = tp.to as string;

    const fromStates = from.split('|').map(s => s.trim());
    const isMultiFrom = fromStates.length > 1;
    const fnName = `${tname}${name}`;
    const code = handlerCode(t);

    lines.push(`/** ${from} → ${to} */`);
    lines.push(`${exp}function ${fnName}<T extends { state: ${stateType} }>(entity: T): T {`);

    if (isMultiFrom) {
      lines.push(`  const validStates: ${stateType}[] = [${fromStates.map(s => `'${s}'`).join(', ')}];`);
      lines.push(`  if (!validStates.includes(entity.state)) {`);
      lines.push(`    throw new ${errorName}(validStates, entity.state);`);
      lines.push(`  }`);
    } else {
      lines.push(`  if (entity.state !== '${fromStates[0]}') {`);
      lines.push(`    throw new ${errorName}('${fromStates[0]}', entity.state);`);
      lines.push(`  }`);
    }

    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push(`  return { ...entity, state: '${to}' as ${stateType} };`);
    }

    lines.push('}');
    lines.push('');
  }

  return lines;
}

// ── Machine → useReducer (Ink target) ────────────────────────────────────

export function generateMachineReducer(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownMachine', node);
  const exp = exportPrefix(node);
  const lines: string[] = [];

  lines.push(`import { useReducer } from 'react';`);
  lines.push('');

  // First emit the standard machine output
  lines.push(...generateMachine(node));

  // Collect states + transitions
  const states = kids(node, 'state');
  const stateNames = states.map(s => {
    const sp = p(s);
    return (sp.name || sp.value) as string;
  });
  const initialState = states.find(s => p(s).initial === 'true' || p(s).initial === true);
  const initialName = initialState ? (p(initialState).name || p(initialState).value) as string : stateNames[0];

  const transitions = kids(node, 'transition');
  const stateType = `${name}State`;

  // Action type union
  const actionNames = transitions.map(t => emitIdentifier(p(t).name as string, 'action', t));
  lines.push(`${exp}type ${name}Action = ${actionNames.map(a => `'${a}'`).join(' | ')};`);
  lines.push('');

  // Reducer function
  lines.push(`${exp}function ${name.charAt(0).toLowerCase() + name.slice(1)}Reducer(state: ${stateType}, action: ${name}Action): ${stateType} {`);
  lines.push(`  const entity = { state };`);
  lines.push(`  switch (action) {`);
  for (const t of transitions) {
    const tp = p(t);
    const tname = emitIdentifier(tp.name as string, 'action', t);
    const fnName = `${tname}${name}`;
    lines.push(`    case '${emitTemplateSafe(tname)}': return ${fnName}(entity).state;`);
  }
  lines.push(`    default: return state;`);
  lines.push(`  }`);
  lines.push('}');
  lines.push('');

  // useReducer hook
  lines.push(`${exp}function use${name}Reducer() {`);
  lines.push(`  const [state, dispatch] = useReducer(${name.charAt(0).toLowerCase() + name.slice(1)}Reducer, '${initialName}' as ${stateType});`);
  lines.push(`  return { state, dispatch } as const;`);
  lines.push('}');
  lines.push('');

  return lines;
}
