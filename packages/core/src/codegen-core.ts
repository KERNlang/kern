/**
 * Core Language Codegen — shared TypeScript generation for KERN's type system
 *
 * Handles: type, interface, fn, machine, error, module, config, store, test, event
 * These are target-agnostic — they compile to TypeScript regardless of target.
 *
 * Machine nodes are KERN's killer feature: 12 lines of KERN → 140+ lines of TS.
 */

import type { IRNode } from './types.js';
import { isTemplateNode, expandTemplateNode } from './template-engine.js';
import { KernCodegenError } from './errors.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function p(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function kids(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter(n => n.type === type) : c;
}

function firstChild(node: IRNode, type: string): IRNode | undefined {
  return kids(node, type)[0];
}

/** Strip common leading whitespace from multiline handler code. */
function dedent(code: string): string {
  const lines = code.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return code;
  const min = Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)?.[1].length ?? 0));
  return lines.map(l => l.slice(min)).join('\n');
}

function handlerCode(node: IRNode): string {
  const handler = firstChild(node, 'handler');
  if (!handler) return '';
  const raw = p(handler).code as string || '';
  return dedent(raw);
}

function exportPrefix(node: IRNode): string {
  return p(node).export === 'false' ? '' : 'export ';
}

// ── Type Alias ───────────────────────────────────────────────────────────
// type name=PlanState values="draft|approved|running|paused|completed|failed|cancelled"
// → export type PlanState = 'draft' | 'approved' | 'running' | ...;

export function generateType(node: IRNode): string[] {
  const { name, values, alias } = p(node) as Record<string, string>;
  const exp = exportPrefix(node);

  if (values) {
    const members = values.split('|').map(v => `'${v.trim()}'`).join(' | ');
    return [`${exp}type ${name} = ${members};`];
  }
  if (alias) {
    return [`${exp}type ${name} = ${alias};`];
  }
  return [`${exp}type ${name} = unknown;`];
}

// ── Interface ────────────────────────────────────────────────────────────
// interface name=Plan extends=Base
//   field name=id type=string
//   field name=state type=PlanState
//   field name=steps type="PlanStep[]"
//   field name=engineId type=string optional=true

export function generateInterface(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const ext = props.extends ? ` extends ${props.extends}` : '';
  const exp = exportPrefix(node);
  const lines: string[] = [];

  lines.push(`${exp}interface ${name}${ext} {`);
  for (const field of kids(node, 'field')) {
    const fp = p(field);
    const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
    lines.push(`  ${fp.name}${opt}: ${fp.type};`);
  }
  lines.push('}');
  return lines;
}

// ── Function ─────────────────────────────────────────────────────────────
// fn name=createPlan params="action:PlanAction,ws:WorkspaceSnapshot" returns=Plan
//   handler <<<
//     return { ... };
//   >>>

export function generateFunction(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const params = props.params as string || '';
  const returns = props.returns as string;
  const isAsync = props.async === 'true' || props.async === true;
  const isStream = props.stream === 'true' || props.stream === true;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Parse params: "action:PlanAction,ws:WorkspaceSnapshot" → "action: PlanAction, ws: WorkspaceSnapshot"
  const paramList = params
    ? params.split(',').map(s => {
        const [pname, ...ptype] = s.split(':').map(t => t.trim());
        return ptype.length > 0 ? `${pname}: ${ptype.join(':')}` : pname;
      }).join(', ')
    : '';

  // stream=true → async generator function
  if (isStream) {
    const yieldType = returns || 'unknown';
    const retClause = `: AsyncGenerator<${yieldType}>`;
    const code = handlerCode(node);
    lines.push(`${exp}async function* ${name}(${paramList})${retClause} {`);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
    lines.push('}');
    return lines;
  }

  const retClause = returns ? `: ${returns}` : '';
  const asyncKw = isAsync ? 'async ' : '';
  const code = handlerCode(node);

  lines.push(`${exp}${asyncKw}function ${name}(${paramList})${retClause} {`);
  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push('}');
  return lines;
}

// ── Error Class ──────────────────────────────────────────────────────────
// error name=AgonError extends=Error
// error name=PlanStateError extends=AgonError
//   field name=expected type="string | string[]"
//   field name=actual type=string
//   message "Invalid plan state: expected ${expected}, got ${actual}"

export function generateError(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const ext = props.extends as string || 'Error';
  const message = props.message as string;
  const exp = exportPrefix(node);
  const fields = kids(node, 'field');
  const lines: string[] = [];

  lines.push(`${exp}class ${name} extends ${ext} {`);

  const code = handlerCode(node);

  if (fields.length > 0) {
    lines.push(`  constructor(`);
    // Check if first field is 'message' — special case: pass to super
    const hasMessageParam = (p(fields[0]).name as string) === 'message';
    for (const field of fields) {
      const fp = p(field);
      const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
      const isMessage = (fp.name as string) === 'message';
      // 'message' param is not readonly — it's passed to super
      if (isMessage) {
        lines.push(`    ${fp.name}${opt}: ${fp.type},`);
      } else {
        lines.push(`    public readonly ${fp.name}${opt}: ${fp.type},`);
      }
    }
    lines.push(`  ) {`);
    if (code) {
      // Custom handler body — replaces auto-generated constructor logic
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    } else if (message) {
      // Check if message references array fields that need formatting
      const arrayFields = fields.filter(f => {
        const ft = p(f).type as string;
        return ft.includes('[]') || ft.includes('string |') || ft.includes('| string');
      });
      for (const f of arrayFields) {
        const fn = p(f).name as string;
        lines.push(`    const ${fn}Str = Array.isArray(${fn}) ? ${fn}.join(' | ') : ${fn};`);
      }
      lines.push(`    super(\`${message}\`);`);
      lines.push(`    this.name = '${name}';`);
    } else if (hasMessageParam) {
      lines.push(`    super(message);`);
      lines.push(`    this.name = '${name}';`);
    } else {
      lines.push(`    super();`);
      lines.push(`    this.name = '${name}';`);
    }
    lines.push(`  }`);
  } else {
    lines.push(`  constructor(message: string) {`);
    lines.push(`    super(message);`);
    lines.push(`    this.name = '${name}';`);
    lines.push(`  }`);
  }

  lines.push('}');
  return lines;
}

// ── State Machine ────────────────────────────────────────────────────────
// KERN's killer feature. 12 lines of KERN → 140+ lines of TypeScript.
//
// machine name=Plan
//   state name=draft initial=true
//   state name=approved
//   state name=running
//   state name=paused
//   state name=completed
//   state name=failed
//   state name=cancelled
//   transition name=approve from=draft to=approved
//   transition name=start from=approved to=running
//   transition name=cancel from="draft|approved|running|paused|failed" to=cancelled
//   transition name=fail from="running|paused" to=failed
//
// Generates:
//   - PlanState type
//   - PlanStateError class
//   - approvePlan(), startPlan(), cancelPlan(), failPlan() functions

export function generateMachine(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Collect states
  const states = kids(node, 'state');
  const stateNames = states.map(s => {
    const sp = p(s);
    return (sp.name || sp.value) as string;
  });

  // State type
  const stateType = `${name}State`;
  lines.push(`${exp}type ${stateType} = ${stateNames.map(s => `'${s}'`).join(' | ')};`);
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
    const tname = tp.name as string;
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
// Additive: also emit a React useReducer hook wrapping the transition functions.
// Called by transpiler-ink.ts when target=ink.

export function generateMachineReducer(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

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
  const actionNames = transitions.map(t => (p(t).name as string));
  lines.push(`${exp}type ${name}Action = ${actionNames.map(a => `'${a}'`).join(' | ')};`);
  lines.push('');

  // Reducer function
  lines.push(`${exp}function ${name.charAt(0).toLowerCase() + name.slice(1)}Reducer(state: ${stateType}, action: ${name}Action): ${stateType} {`);
  lines.push(`  const entity = { state };`);
  lines.push(`  switch (action) {`);
  for (const t of transitions) {
    const tp = p(t);
    const tname = tp.name as string;
    const fnName = `${tname}${name}`;
    lines.push(`    case '${tname}': return ${fnName}(entity).state;`);
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

// ── Config ───────────────────────────────────────────────────────────────
// config name=AgonConfig
//   field name=timeout type=number default=120
//   field name=approvalLevel type=ApprovalLevel default="plan"

export function generateConfig(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const exp = exportPrefix(node);
  const fields = kids(node, 'field');
  const lines: string[] = [];

  // Interface
  lines.push(`${exp}interface ${name} {`);
  for (const field of fields) {
    const fp = p(field);
    const opt = fp.default !== undefined ? '?' : '';
    lines.push(`  ${fp.name}${opt}: ${fp.type};`);
  }
  lines.push('}');
  lines.push('');

  // Defaults object
  lines.push(`${exp}const DEFAULT_${name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}: Required<${name}> = {`);
  for (const field of fields) {
    const fp = p(field);
    const ftype = fp.type as string;
    let def = fp.default as string;

    if (def === undefined) {
      if (ftype === 'number') def = '0';
      else if (ftype === 'boolean') def = 'false';
      else if (ftype.endsWith('[]')) def = '[]';
      else def = "''";
    } else if (ftype === 'string' || (!['number', 'boolean'].includes(ftype) && !ftype.endsWith('[]') && !def.startsWith("'") && !def.startsWith('"'))) {
      def = `'${def}'`;
    }

    lines.push(`  ${fp.name}: ${def},`);
  }
  lines.push('};');

  return lines;
}

// ── Store ────────────────────────────────────────────────────────────────
// store name=Plan path="~/.agon/plans" key=id
//   model Plan

export function generateStore(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const storePath = props.path as string || '~/.data';
  const key = props.key as string || 'id';
  const model = props.model as string || 'unknown';
  const exp = exportPrefix(node);
  const lines: string[] = [];
  const dirConst = `${name.toUpperCase()}_DIR`;

  const resolvedPath = storePath.startsWith('~/')
    ? `join(homedir(), '${storePath.slice(2)}')`
    : `'${storePath}'`;

  lines.push(`import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';`);
  lines.push(`import { join, resolve } from 'node:path';`);
  lines.push(`import { homedir } from 'node:os';`);
  lines.push('');
  lines.push(`const ${dirConst} = ${resolvedPath};`);
  lines.push('');
  lines.push(`function ensure${name}Dir(): void {`);
  lines.push(`  mkdirSync(${dirConst}, { recursive: true });`);
  lines.push('}');
  lines.push('');
  lines.push(`function safe${name}Path(id: string): string {`);
  lines.push(`  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '');`);
  lines.push(`  const full = resolve(${dirConst}, \`\${sanitized}.json\`);`);
  lines.push(`  if (!full.startsWith(resolve(${dirConst}))) throw new Error(\`Invalid ID: \${id}\`);`);
  lines.push(`  return full;`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function save${name}(item: ${model}): void {`);
  lines.push(`  ensure${name}Dir();`);
  lines.push(`  writeFileSync(safe${name}Path((item as any).${key}), JSON.stringify(item, null, 2) + '\\n');`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function load${name}(id: string): ${model} | null {`);
  lines.push(`  try { return JSON.parse(readFileSync(safe${name}Path(id), 'utf-8')) as ${model}; }`);
  lines.push(`  catch { return null; }`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function list${name}s(limit = 20): ${model}[] {`);
  lines.push(`  ensure${name}Dir();`);
  lines.push(`  try {`);
  lines.push(`    return readdirSync(${dirConst}).filter(f => f.endsWith('.json'))`);
  lines.push(`      .map(f => JSON.parse(readFileSync(join(${dirConst}, f), 'utf-8')) as ${model})`);
  lines.push(`      .sort((a: any, b: any) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))`);
  lines.push(`      .slice(0, limit);`);
  lines.push(`  } catch { return []; }`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function delete${name}(id: string): boolean {`);
  lines.push(`  try { unlinkSync(safe${name}Path(id)); return true; }`);
  lines.push(`  catch { return false; }`);
  lines.push('}');

  return lines;
}

// ── Test ─────────────────────────────────────────────────────────────────
// test name="Plan Transitions"
//   describe name=approvePlan
//     it name="transitions draft → approved"
//       handler <<<
//         expect(approvePlan(makePlan('draft')).state).toBe('approved');
//       >>>

export function generateTest(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const lines: string[] = [];

  lines.push(`import { describe, it, expect } from 'vitest';`);
  lines.push('');

  // Top-level setup handler
  const setup = handlerCode(node);
  if (setup) {
    for (const line of setup.split('\n')) lines.push(line);
    lines.push('');
  }

  lines.push(`describe('${name}', () => {`);

  for (const desc of kids(node, 'describe')) {
    const dname = p(desc).name as string;
    lines.push(`  describe('${dname}', () => {`);

    for (const test of kids(desc, 'it')) {
      const tname = p(test).name as string;
      const code = handlerCode(test);
      lines.push(`    it('${tname}', () => {`);
      if (code) {
        for (const line of code.split('\n')) lines.push(`      ${line}`);
      }
      lines.push(`    });`);
    }

    lines.push(`  });`);
  }

  // Top-level it blocks
  for (const test of kids(node, 'it')) {
    const tname = p(test).name as string;
    const code = handlerCode(test);
    lines.push(`  it('${tname}', () => {`);
    if (code) {
      for (const line of code.split('\n')) lines.push(`    ${line}`);
    }
    lines.push(`  });`);
  }

  lines.push('});');
  return lines;
}

// ── Event ────────────────────────────────────────────────────────────────
// event name=ForgeEvent
//   type name="baseline:start"
//   type name="baseline:done" data="{ passes: boolean }"
//   type name="winner:determined" data="{ winner: string, bestScore: number }"

export function generateEvent(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const exp = exportPrefix(node);
  const types = kids(node, 'type');
  const lines: string[] = [];

  // Event type union
  lines.push(`${exp}type ${name}Type = ${types.map(t => `'${(p(t).name || p(t).value) as string}'`).join(' | ')};`);
  lines.push('');

  // Event interface
  lines.push(`${exp}interface ${name} {`);
  lines.push(`  type: ${name}Type;`);
  lines.push(`  engineId?: string;`);
  lines.push(`  data?: Record<string, unknown>;`);
  lines.push('}');
  lines.push('');

  // Typed event map
  lines.push(`${exp}interface ${name}Map {`);
  for (const t of types) {
    const tp = p(t);
    const tname = (tp.name || tp.value) as string;
    const data = tp.data as string || 'Record<string, unknown>';
    lines.push(`  '${tname}': ${data};`);
  }
  lines.push('}');
  lines.push('');

  // Callback type
  lines.push(`${exp}type ${name}Callback = (event: ${name}) => void;`);

  return lines;
}

// ── On — generic event handler ────────────────────────────────────────────
// on event=click handler=handleClick
// on event=submit
//   handler <<<
//     e.preventDefault();
//     await submitForm(data);
//   >>>
// on event=key key=Enter
//   handler <<<
//     processInput(buffer);
//   >>>
// on event=message
//   handler <<<
//     const data = JSON.parse(event.data);
//     dispatch(data);
//   >>>

export function generateOn(node: IRNode): string[] {
  const props = p(node);
  const event = (props.event || props.name) as string;
  const handlerName = props.handler as string;
  const key = props.key as string;
  const code = handlerCode(node);
  const exp = exportPrefix(node);
  const lines: string[] = [];

  if (handlerName && !code) {
    // Reference to existing handler: on event=click handler=handleClick
    lines.push(`${exp}const on${capitalize(event)} = ${handlerName};`);
    return lines;
  }

  // Determine event parameter type (plain DOM types — target-agnostic)
  const paramType = event === 'key' || event === 'keydown' || event === 'keyup' ? 'e: KeyboardEvent'
    : event === 'message' ? 'event: MessageEvent'
    : event === 'submit' ? 'e: SubmitEvent'
    : event === 'click' ? 'e: MouseEvent'
    : event === 'change' ? 'e: Event'
    : event === 'focus' || event === 'blur' ? 'e: FocusEvent'
    : event === 'drag' || event === 'drop' ? 'e: DragEvent'
    : event === 'scroll' ? 'e: Event'
    : event === 'resize' ? 'e: UIEvent'
    : event === 'connect' || event === 'disconnect' ? 'ws: WebSocket'
    : event === 'error' ? 'error: Error'
    : `e: Event`;

  const fnName = handlerName || `handle${capitalize(event)}`;
  const isAsync = props.async === 'true' || props.async === true;
  const asyncKw = isAsync ? 'async ' : '';

  // Key filter guard
  const keyGuard = key ? `  if (key !== '${key}') return;\n` : '';

  lines.push(`${exp}${asyncKw}function ${fnName}(${paramType}) {`);
  if (keyGuard) lines.push(keyGuard.trimEnd());
  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push('}');
  return lines;
}

// ── WebSocket — bidirectional communication ──────────────────────────────
// websocket path=/ws
//   on event=connect
//     handler <<<ws.send(JSON.stringify({ type: 'hello' }));>>>
//   on event=message
//     handler <<<
//       const data = JSON.parse(event.data);
//       broadcast(data);
//     >>>
//   on event=disconnect
//     handler <<<console.log('client disconnected');>>>

export function generateWebSocket(node: IRNode): string[] {
  const props = p(node);
  const path = (props.path || '/ws') as string;
  const name = props.name as string || 'ws';
  const exp = exportPrefix(node);
  const lines: string[] = [];

  const onNodes = kids(node, 'on');
  const connectHandler = onNodes.find(n => {
    const e = (p(n).event || p(n).name) as string;
    return e === 'connect' || e === 'connection';
  });
  const messageHandler = onNodes.find(n => {
    const e = (p(n).event || p(n).name) as string;
    return e === 'message';
  });
  const disconnectHandler = onNodes.find(n => {
    const e = (p(n).event || p(n).name) as string;
    return e === 'disconnect' || e === 'close';
  });
  const errorHandler = onNodes.find(n => {
    const e = (p(n).event || p(n).name) as string;
    return e === 'error';
  });

  lines.push(`${exp}function setup${capitalize(name)}(wss: WebSocketServer) {`);
  lines.push(`  wss.on('connection', (ws, req) => {`);
  lines.push(`    const path = req.url || '${path}';`);

  if (connectHandler) {
    const code = handlerCode(connectHandler);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
  }

  lines.push('');
  lines.push(`    ws.on('message', (raw) => {`);
  if (messageHandler) {
    const code = handlerCode(messageHandler);
    lines.push(`      const data = JSON.parse(raw.toString());`);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`      ${line}`);
      }
    }
  }
  lines.push(`    });`);

  if (errorHandler) {
    lines.push('');
    lines.push(`    ws.on('error', (error) => {`);
    const code = handlerCode(errorHandler);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`      ${line}`);
      }
    }
    lines.push(`    });`);
  }

  lines.push('');
  lines.push(`    ws.on('close', () => {`);
  if (disconnectHandler) {
    const code = handlerCode(disconnectHandler);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`      ${line}`);
      }
    }
  }
  lines.push(`    });`);
  lines.push(`  });`);
  lines.push('}');

  return lines;
}

// ── Module ───────────────────────────────────────────────────────────────
// module name=@agon/core
//   export from="./plan.js" names="createPlan,advanceStep"

export function generateModule(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const lines: string[] = [];

  lines.push(`// ── Module: ${name} ──`);
  lines.push('');

  for (const exp of kids(node, 'export')) {
    const ep = p(exp);
    const from = ep.from as string;
    const names = ep.names as string;
    const typeNames = ep.types as string;
    const star = ep.star === 'true' || ep.star === true;

    if (from && !names && !typeNames && star) {
      lines.push(`export * from '${from}';`);
    }
    if (from && names) {
      lines.push(`export { ${names.split(',').map(s => s.trim()).join(', ')} } from '${from}';`);
    }
    if (from && typeNames) {
      lines.push(`export type { ${typeNames.split(',').map(s => s.trim()).join(', ')} } from '${from}';`);
    }
  }

  // Inline child definitions
  for (const child of kids(node)) {
    if (child.type === 'export') continue;
    lines.push(...generateCoreNode(child));
    lines.push('');
  }

  return lines;
}

// ── Import ──────────────────────────────────────────────────────────────
// import from="node:fs" names="readFileSync,writeFileSync"
// → import { readFileSync, writeFileSync } from 'node:fs';
//
// import from="./types.js" names="Plan" types=true
// → import type { Plan } from './types.js';
//
// import from="node:path" default=path
// → import path from 'node:path';
//
// import from="node:fs" default=fs names="readFileSync"
// → import fs, { readFileSync } from 'node:fs';

export function generateImport(node: IRNode): string[] {
  const props = p(node);
  const from = props.from as string;
  const names = props.names as string | undefined;
  const defaultImport = props.default as string | undefined;
  const isTypeOnly = props.types === 'true' || props.types === true;

  if (!from) return [];

  const typeKw = isTypeOnly ? 'type ' : '';
  const namedList = names
    ? names.split(',').map(s => s.trim()).join(', ')
    : '';

  if (defaultImport && namedList) {
    return [`import ${typeKw}${defaultImport}, { ${namedList} } from '${from}';`];
  }
  if (defaultImport) {
    return [`import ${typeKw}${defaultImport} from '${from}';`];
  }
  if (namedList) {
    return [`import ${typeKw}{ ${namedList} } from '${from}';`];
  }
  // Side-effect import
  return [`import '${from}';`];
}

// ── Const ───────────────────────────────────────────────────────────────
// const name=AGON_HOME type=string
//   handler <<<
//     join(homedir(), '.agon')
//   >>>
// → export const AGON_HOME: string = join(homedir(), '.agon');
//
// const name=DEFAULT_WEIGHTS type=ScoreWeights value="{ pass: 50 }"
// → export const DEFAULT_WEIGHTS: ScoreWeights = { pass: 50 };

export function generateConst(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const constType = props.type as string | undefined;
  const value = props.value as string | undefined;
  const exp = exportPrefix(node);
  const code = handlerCode(node);

  const typeAnnotation = constType ? `: ${constType}` : '';

  if (code) {
    return [`${exp}const ${name}${typeAnnotation} = ${code.trim()};`];
  }
  if (value) {
    return [`${exp}const ${name}${typeAnnotation} = ${value};`];
  }
  return [`${exp}const ${name}${typeAnnotation};`];
}

// ── Shared Helpers (exported for @kernlang/react) ────────────────────────────

/** Parse "name:Type,name2:Type2" → "name: Type, name2: Type2" */
export function parseParamList(params: string): string {
  if (!params) return '';
  return params.split(',').map(s => {
    const [pname, ...ptype] = s.split(':').map(t => t.trim());
    return ptype.length > 0 ? `${pname}: ${ptype.join(':')}` : pname;
  }).join(', ');
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Hook ─────────────────────────────────────────────────────────────────
// hook name=useSearch params="initialState:SearchState" returns=UseSearchResult
//   state name=query type=string init="initialState.query"
//   ref name=abortCtrl type=AbortController init="new AbortController()"
//   context name=env type=EnvConfig source=EnvContext
//   handler <<<
//     const { data } = useSWR(cacheKey, fetcher);
//   >>>
//   memo name=cacheKey deps="query,filters"
//     handler <<<
//       return buildCacheKey(query, filters);
//     >>>
//   callback name=handleFilter params="field:string,value:string" deps="query"
//     handler <<<
//       setQuery(prev => updateFilter(prev, field, value));
//     >>>
//   effect deps="query"
//     handler <<<
//       trackSearch(query);
//     >>>
//   returns names="products:data?.products,isLoading,handleFilter,cacheKey"

export function generateHook(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const params = props.params as string || '';
  const returnsType = props.returns as string | undefined;
  const exp = exportPrefix(node);
  const lines: string[] = [];
  const reactImports = new Set<string>();

  // Parse params
  const paramList = parseParamList(params);
  const retClause = returnsType ? `: ${returnsType}` : '';

  lines.push(`${exp}function ${name}(${paramList})${retClause} {`);

  // Emit children in source order — returns is always last
  const children = kids(node);
  const returnsNode = children.find(c => c.type === 'returns');
  const ordered = children.filter(c => c.type !== 'returns');

  for (const child of ordered) {
    const cp = p(child);
    switch (child.type) {
      case 'state': {
        reactImports.add('useState');
        const sname = cp.name as string;
        const stype = cp.type as string || 'unknown';
        const sinit = cp.init as string || 'undefined';
        const setter = `set${capitalize(sname)}`;
        lines.push(`  const [${sname}, ${setter}] = useState<${stype}>(${sinit});`);
        break;
      }
      case 'ref': {
        reactImports.add('useRef');
        const rname = cp.name as string;
        const rtype = cp.type as string || 'unknown';
        const rinit = cp.init as string || 'null';
        lines.push(`  const ${rname} = useRef<${rtype}>(${rinit});`);
        break;
      }
      case 'context': {
        reactImports.add('useContext');
        const cname = cp.name as string;
        const csource = cp.source as string;
        lines.push(`  const ${cname} = useContext(${csource});`);
        break;
      }
      case 'handler': {
        const code = cp.code as string || '';
        const dedented = dedent(code);
        for (const line of dedented.split('\n')) {
          lines.push(`  ${line}`);
        }
        break;
      }
      case 'memo': {
        reactImports.add('useMemo');
        const mname = cp.name as string;
        const mdeps = cp.deps as string || '';
        const mcode = handlerCode(child);
        const depsArr = mdeps ? `[${mdeps}]` : '[]';
        lines.push(`  const ${mname} = useMemo(() => {`);
        if (mcode) {
          for (const line of mcode.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        lines.push(`  }, ${depsArr});`);
        break;
      }
      case 'callback': {
        reactImports.add('useCallback');
        const cbname = cp.name as string;
        const cbparams = cp.params as string || '';
        const cbdeps = cp.deps as string || '';
        const cbcode = handlerCode(child);
        const cbParamList = parseParamList(cbparams);
        const cbDepsArr = cbdeps ? `[${cbdeps}]` : '[]';
        lines.push(`  const ${cbname} = useCallback((${cbParamList}) => {`);
        if (cbcode) {
          for (const line of cbcode.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        lines.push(`  }, ${cbDepsArr});`);
        break;
      }
      case 'effect': {
        reactImports.add('useEffect');
        const edeps = cp.deps as string || '';
        const ecode = handlerCode(child);
        const eDepsArr = edeps ? `[${edeps}]` : '[]';
        lines.push(`  useEffect(() => {`);
        if (ecode) {
          for (const line of ecode.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        // Check for cleanup block
        const cleanupNode = firstChild(child, 'cleanup');
        if (cleanupNode) {
          const cleanupCode = p(cleanupNode).code as string || '';
          const cleanupDedented = dedent(cleanupCode);
          lines.push(`    return () => {`);
          for (const line of cleanupDedented.split('\n')) {
            lines.push(`      ${line}`);
          }
          lines.push(`    };`);
        }
        lines.push(`  }, ${eDepsArr});`);
        break;
      }
      // Skip unknown child types silently
    }
  }

  // Returns — always last
  if (returnsNode) {
    const rnames = p(returnsNode).names as string || '';
    const entries = rnames.split(',').map(e => {
      const [key, ...valueParts] = e.split(':');
      const value = valueParts.join(':').trim();
      return value ? `${key.trim()}: ${value}` : key.trim();
    });
    lines.push(`  return { ${entries.join(', ')} };`);
  }

  lines.push('}');

  // Prepend React imports
  if (reactImports.size > 0) {
    const importLine = `import { ${[...reactImports].sort().join(', ')} } from 'react';`;
    lines.unshift('');
    lines.unshift(importLine);
  }

  return lines;
}

// ── Reason & Confidence Annotations ──────────────────────────────────────

export function emitReasonAnnotations(node: IRNode): string[] {
  const reasonNode = firstChild(node, 'reason');
  const evidenceNode = firstChild(node, 'evidence');
  const needsNodes = kids(node, 'needs');
  const confidence = p(node).confidence as string | undefined;

  if (!reasonNode && !evidenceNode && !confidence && needsNodes.length === 0) return [];

  const lines: string[] = ['/**'];
  if (confidence) lines.push(` * @confidence ${confidence}`);
  if (reasonNode) {
    const rp = p(reasonNode);
    lines.push(` * @reason ${rp.because || ''}`);
    if (rp.basis) lines.push(` * @basis ${rp.basis}`);
    if (rp.survives) lines.push(` * @survives ${rp.survives}`);
  }
  if (evidenceNode) {
    const ep = p(evidenceNode);
    const parts = [`source=${ep.source}`];
    if (ep.method) parts.push(`method=${ep.method}`);
    if (ep.authority) parts.push(`authority=${ep.authority}`);
    lines.push(` * @evidence ${parts.join(', ')}`);
  }
  for (const needsNode of needsNodes) {
    const np = p(needsNode);
    const desc = np.what as string || np.description as string || '';
    const wouldRaise = np['would-raise-to'] as string;
    const tag = wouldRaise ? `${desc} (would raise to ${wouldRaise})` : desc;
    lines.push(` * @needs ${tag}`);
  }
  lines.push(' */');
  return lines;
}

/** Emit a TODO comment for nodes with low literal confidence (< 0.5). */
export function emitLowConfidenceTodo(node: IRNode, confidence: string | undefined): string[] {
  if (!confidence) return [];
  const val = parseFloat(confidence);
  if (isNaN(val) || val >= 0.5 || confidence.includes(':')) return [];
  const name = p(node).name as string || node.type;
  return [`// TODO(low-confidence): ${name} confidence=${confidence}`];
}

// ── Ground Layer: derive ─────────────────────────────────────────────────
// derive name=loudness expr={{average(stems)}} type=number deps="stems"
// → export const loudness: number = average(stems);

export function generateDerive(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string;
  const expr = props.expr as string;
  const constType = props.type as string | undefined;
  const exp = exportPrefix(node);

  const typeAnnotation = constType ? `: ${constType}` : '';
  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = ${expr};`];
}

// ── Ground Layer: transform ──────────────────────────────────────────────
// transform name=limitStems target="track.stems" via="limit(4)" type="Stem[]"
// → export const limitStems: Stem[] = limit(track.stems, 4);

export function generateTransform(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string;
  const target = props.target as string | undefined;
  const via = props.via as string | undefined;
  const constType = props.type as string | undefined;
  const exp = exportPrefix(node);
  const code = handlerCode(node);

  const typeAnnotation = constType ? `: ${constType}` : '';

  if (code) {
    // Handler block form — generate a function
    const lines: string[] = [...todo, ...annotations];
    lines.push(`${exp}function ${name}(state: unknown)${typeAnnotation} {`);
    for (const line of code.split('\n')) {
      lines.push(`  ${line}`);
    }
    lines.push('}');
    return lines;
  }

  if (target && via) {
    return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = ${via.replace(/\(/, `(${target}, `).replace(/, \)/, ')')};`];
  }
  if (via) {
    return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation} = ${via};`];
  }
  return [...todo, ...annotations, `${exp}const ${name}${typeAnnotation};`];
}

// ── Ground Layer: action ─────────────────────────────────────────────────
// action name=notifyOwner idempotent=true reversible=true
//   handler <<<await email.send(track.owner, 'processed');>>>

export function generateAction(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string;
  const idempotent = props.idempotent === 'true' || props.idempotent === true;
  const reversible = props.reversible === 'true' || props.reversible === true;
  const params = props.params as string || '';
  const returns = props.returns as string | undefined;
  const exp = exportPrefix(node);
  const code = handlerCode(node);

  const lines: string[] = [...todo, ...annotations];

  // JSDoc for action metadata
  const metaParts: string[] = [];
  if (idempotent) metaParts.push('idempotent=true');
  if (reversible) metaParts.push('reversible=true');
  if (metaParts.length > 0) {
    lines.push(`/** @action ${metaParts.join(' ')} */`);
  }

  const paramList = params ? parseParamList(params) : '';
  const retClause = returns ? `: Promise<${returns}>` : ': Promise<void>';
  lines.push(`${exp}async function ${name}(${paramList})${retClause} {`);
  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push('}');
  return lines;
}

// ── Ground Layer: guard (extended — already in NODE_TYPES) ───────────────
// guard name=published expr={{track.status == "published"}} else=403

export function generateGuard(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string || 'guard';
  const expr = props.expr as string;
  const elseCode = props.else as string | undefined;

  const lines: string[] = [...todo, ...annotations];

  if (elseCode && /^\d+$/.test(elseCode)) {
    lines.push(`if (!(${expr})) { throw new HttpError(${elseCode}, 'Guard: ${name}'); }`);
  } else if (elseCode) {
    lines.push(`if (!(${expr})) { ${elseCode}; }`);
  } else {
    lines.push(`if (!(${expr})) { throw new Error('Guard failed: ${name}'); }`);
  }
  return lines;
}

// ── Ground Layer: assume ─────────────────────────────────────────────────
// assume expr={{track.owner == $auth.user}} scope=request evidence="route-signing" fallback="throw AuthError()"

export function generateAssume(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const expr = props.expr as string;
  const scope = props.scope as string || 'request';
  const evidence = props.evidence as string | undefined;
  const fallback = props.fallback as string | undefined;

  if (!evidence) throw new KernCodegenError('assume requires evidence prop', node);
  if (!fallback) throw new KernCodegenError('assume requires fallback prop', node);

  const lines: string[] = [...todo, ...annotations];
  lines.push(`/** @assume ${expr} @scope ${scope} @evidence ${evidence} */`);
  lines.push(`if (process.env.NODE_ENV !== 'production') {`);
  lines.push(`  if (!(${expr})) { ${fallback}; }`);
  lines.push(`}`);
  return lines;
}

// ── Ground Layer: invariant ──────────────────────────────────────────────
// invariant name=stemLimit expr={{visible_stems <= policy.max_stems($auth.tier)}}

export function generateInvariant(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string || 'invariant';
  const expr = props.expr as string;

  const lines: string[] = [...todo, ...annotations];
  lines.push(`console.assert(${expr}, 'Invariant: ${name}');`);
  return lines;
}

// ── Ground Layer: each (ground-layer, not inside parallel) ───────────────
// each name=stem in="track.stems"
//   derive name=normalized expr={{normalize(stem.amplitude)}}

export function generateEach(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string || 'item';
  const collection = props.in as string;
  const index = props.index as string | undefined;

  const lines: string[] = [...todo, ...annotations];
  if (index) {
    lines.push(`for (const [${index}, ${name}] of (${collection}).entries()) {`);
  } else {
    lines.push(`for (const ${name} of ${collection}) {`);
  }

  for (const child of kids(node)) {
    const childLines = generateCoreNode(child);
    for (const line of childLines) {
      lines.push(`  ${line}`);
    }
  }

  lines.push('}');
  return lines;
}

// ── Ground Layer: collect ────────────────────────────────────────────────
// collect name=overThreshold from="track.stems" where={{measure(stem.loudness) > threshold}} limit=10

export function generateCollect(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string;
  const from = props.from as string;
  const where = props.where as string | undefined;
  const limit = props.limit as string | undefined;
  const order = props.order as string | undefined;
  const exp = exportPrefix(node);

  let chain = from;
  if (where) chain += `.filter(item => ${where})`;
  if (order) chain += `.sort((a, b) => ${order})`;
  if (limit) chain += `.slice(0, ${limit})`;

  return [...todo, ...annotations, `${exp}const ${name} = ${chain};`];
}

// ── Ground Layer: branch / path ──────────────────────────────────────────
// branch name=tierRoute on="user.tier"
//   path value="free"
//     derive name=maxStems expr={{4}} type=number

export function generateBranch(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string || 'branch';
  const on = props.on as string;
  const paths = kids(node, 'path');

  const lines: string[] = [...todo, ...annotations];
  lines.push(`/** branch: ${name} */`);
  lines.push(`switch (${on}) {`);

  for (const pathNode of paths) {
    const pp = p(pathNode);
    const value = pp.value as string;
    lines.push(`  case '${value}': {`);
    for (const child of kids(pathNode)) {
      const childLines = generateCoreNode(child);
      for (const line of childLines) {
        lines.push(`    ${line}`);
      }
    }
    lines.push(`    break;`);
    lines.push(`  }`);
  }

  lines.push('}');
  return lines;
}

// ── Ground Layer: resolve / candidate / discriminator ────────────────────
// resolve name=normStrategy
//   candidate name=aggressive
//     handler <<<return aggressiveNormalize(signal);>>>
//   discriminator method=benchmark metric="snr"
//     handler <<<...>>>

export function generateResolve(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string;
  const candidates = kids(node, 'candidate');
  const discriminator = firstChild(node, 'discriminator');

  if (!discriminator) throw new KernCodegenError('resolve requires discriminator', node);

  const lines: string[] = [...todo, ...annotations];
  const dp = p(discriminator);
  const method = dp.method as string || 'select';
  const metric = dp.metric as string || '';

  // Candidate array
  lines.push(`/** resolve: ${name} */`);
  lines.push(`const _${name}_candidates = [`);
  for (const c of candidates) {
    const cp = p(c);
    const cname = cp.name as string;
    const code = handlerCode(c);
    lines.push(`  { name: '${cname}', fn: (signal: unknown) => { ${code.trim()} } },`);
  }
  lines.push(`];`);
  lines.push('');

  // Resolver function
  const discCode = handlerCode(discriminator);
  lines.push(`async function resolve${capitalize(name)}(signal: unknown): Promise<unknown> {`);
  lines.push(`  const candidates = _${name}_candidates;`);
  lines.push(`  // discriminator: ${method}(${metric})`);
  if (discCode) {
    for (const line of discCode.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push(`  return candidates[winnerIdx].fn(signal);`);
  lines.push('}');
  return lines;
}

// ── Ground Layer: expect ─────────────────────────────────────────────────
// expect name=clipRate expr={{clip_flags_rate}} within="0.02..0.08"

export function generateExpect(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string || 'expected';
  const expr = props.expr as string;
  const within = props.within as string | undefined;
  const max = props.max as string | undefined;
  const min = props.min as string | undefined;

  const lines: string[] = [...todo, ...annotations];
  lines.push(`if (process.env.NODE_ENV !== 'production') {`);
  lines.push(`  const _${name} = ${expr};`);

  if (within) {
    const [lo, hi] = within.split('..');
    lines.push(`  console.assert(_${name} >= ${lo} && _${name} <= ${hi}, 'Expected ${name} in [${lo}, ${hi}], got ' + _${name});`);
  } else if (min && max) {
    lines.push(`  console.assert(_${name} >= ${min} && _${name} <= ${max}, 'Expected ${name} in [${min}, ${max}], got ' + _${name});`);
  } else if (max) {
    lines.push(`  console.assert(_${name} <= ${max}, 'Expected ${name} <= ${max}, got ' + _${name});`);
  } else if (min) {
    lines.push(`  console.assert(_${name} >= ${min}, 'Expected ${name} >= ${min}, got ' + _${name});`);
  } else {
    lines.push(`  console.assert(_${name} != null, 'Expected ${name} to be defined');`);
  }

  lines.push('}');
  return lines;
}

// ── Ground Layer: recover / strategy ─────────────────────────────────────
// recover name=paymentFlow
//   strategy name=retry max=3 delay=1000
//   strategy name=fallback
//     handler <<<throw new PaymentError('All recovery exhausted');>>>

export function generateRecover(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = props.name as string;
  const strategies = kids(node, 'strategy');

  const hasFallback = strategies.some(s => (p(s).name as string) === 'fallback');
  if (!hasFallback) throw new KernCodegenError('recover requires a fallback strategy', node);

  const lines: string[] = [...todo, ...annotations];
  lines.push(`/** recover: ${name} */`);
  lines.push(`async function ${name}WithRecovery<T>(fn: () => Promise<T>): Promise<T> {`);

  for (const strategy of strategies) {
    const sp = p(strategy);
    const sname = sp.name as string;
    const code = handlerCode(strategy);

    if (sname === 'retry') {
      const max = Number(sp.max) || 3;
      const delay = Number(sp.delay) || 1000;
      lines.push(`  // strategy: retry (max=${max}, delay=${delay}ms)`);
      lines.push(`  for (let _attempt = 0; _attempt < ${max}; _attempt++) {`);
      lines.push(`    try { return await fn(); }`);
      lines.push(`    catch { if (_attempt < ${max - 1}) await new Promise(r => setTimeout(r, ${delay})); }`);
      lines.push(`  }`);
    } else if (sname === 'fallback') {
      lines.push(`  // strategy: fallback (terminal)`);
      if (code) {
        for (const line of code.split('\n')) {
          lines.push(`  ${line}`);
        }
      } else {
        lines.push(`  throw new Error('All recovery strategies exhausted for ${name}');`);
      }
    } else {
      // compensate, degrade, or custom
      lines.push(`  // strategy: ${sname}`);
      lines.push(`  try {`);
      if (code) {
        for (const line of code.split('\n')) {
          lines.push(`    ${line}`);
        }
      }
      lines.push(`  } catch {}`);
    }
  }

  lines.push('}');
  return lines;
}

// ── Ground Layer: pattern / apply ────────────────────────────────────────
// pattern → registerTemplate() alias (handled by template engine)
// apply → expandTemplateNode() alias

export function generatePattern(node: IRNode): string[] {
  // pattern nodes are registered as templates — no direct output
  return [];
}

export function generateApply(node: IRNode): string[] {
  // apply nodes expand the referenced pattern
  const props = p(node);
  const patternName = props.pattern as string;
  if (!patternName) return [];

  // Delegate to template expansion with the pattern name as node type
  const syntheticNode: IRNode = { ...node, type: patternName };
  if (isTemplateNode(patternName)) {
    return expandTemplateNode(syntheticNode);
  }
  return [`// apply: pattern '${patternName}' not found`];
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export const CORE_NODE_TYPES = new Set([
  'type', 'interface', 'field', 'fn',
  'machine', 'transition',
  'error', 'module', 'export',
  'config', 'store',
  'test', 'describe', 'it',
  'event', 'import', 'const',
  'hook',
  'on', 'websocket',
  'template', 'slot', 'body',
  // Ground layer
  'derive', 'transform', 'action', 'guard', 'assume', 'invariant',
  'each', 'collect', 'branch', 'path',
  'resolve', 'candidate', 'discriminator',
  'expect', 'recover', 'strategy',
  'pattern', 'apply',
  // Reason layer
  'reason', 'evidence',
  // Confidence layer
  'needs',
]);

/** Check if a node type is a core language construct. */
export function isCoreNode(type: string): boolean {
  return CORE_NODE_TYPES.has(type);
}

/** Generate TypeScript for any core language node. */
export function generateCoreNode(node: IRNode): string[] {
  switch (node.type) {
    case 'type': return generateType(node);
    case 'interface': return generateInterface(node);
    case 'fn': return generateFunction(node);
    case 'machine': return generateMachine(node);
    case 'error': return generateError(node);
    case 'module': return generateModule(node);
    case 'config': return generateConfig(node);
    case 'store': return generateStore(node);
    case 'test': return generateTest(node);
    case 'event': return generateEvent(node);
    case 'import': return generateImport(node);
    case 'const': return generateConst(node);
    case 'hook': return generateHook(node);
    case 'on': return generateOn(node);
    case 'websocket': return generateWebSocket(node);
    // Ground layer
    case 'derive': return generateDerive(node);
    case 'transform': return generateTransform(node);
    case 'action': return generateAction(node);
    case 'guard': return generateGuard(node);
    case 'assume': return generateAssume(node);
    case 'invariant': return generateInvariant(node);
    case 'each': return generateEach(node);
    case 'collect': return generateCollect(node);
    case 'branch': return generateBranch(node);
    case 'resolve': return generateResolve(node);
    case 'expect': return generateExpect(node);
    case 'recover': return generateRecover(node);
    case 'pattern': return generatePattern(node);
    case 'apply': return generateApply(node);
    // Template / structural definitions produce no output
    case 'template': return [];
    case 'slot': return [];
    case 'body': return [];
    case 'path': return [];
    case 'candidate': return [];
    case 'discriminator': return [];
    case 'strategy': return [];
    case 'reason': return [];
    case 'evidence': return [];
    case 'needs': return [];
    default:
      // Check if this is a template instance
      if (isTemplateNode(node.type)) return expandTemplateNode(node);
      return [];
  }
}
