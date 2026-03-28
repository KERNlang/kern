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
import { defaultRuntime, type KernRuntime } from './runtime.js';

// Re-export emitters and helpers from extracted modules for backward compatibility.
// All existing `import { emitIdentifier } from './codegen-core.js'` paths continue to work.
export { emitIdentifier, emitStringLiteral, emitPath, emitTemplateSafe, emitTypeAnnotation, emitImportSpecifier } from './codegen/emitters.js';
export { getProps, getChildren, getFirstChild, getStyles, getPseudoStyles, getThemeRefs, dedent, cssPropertyName, handlerCode, exportPrefix, capitalize, parseParamList, emitReasonAnnotations, emitLowConfidenceTodo } from './codegen/helpers.js';

// Import for local use within this file
import { emitIdentifier, emitStringLiteral, emitPath, emitTemplateSafe, emitTypeAnnotation, emitImportSpecifier } from './codegen/emitters.js';
import { getProps, getChildren, getFirstChild, dedent, handlerCode, exportPrefix, capitalize, parseParamList, emitReasonAnnotations, emitLowConfidenceTodo } from './codegen/helpers.js';

// ── Safe Emitters & Helpers ───────────────────────────────────────────────
// Implementations extracted to codegen/emitters.ts and codegen/helpers.ts.
// Re-exported above for backward compatibility.

// (emitter implementations in codegen/emitters.ts)

// (emitTypeAnnotation, emitImportSpecifier implementations in codegen/emitters.ts)

// ── Evolved Generators (v4) ─────────────────────────────────────────────
// Populated at startup by evolved-node-loader. Checked in generateCoreNode
// before the default case, allowing graduated nodes to produce output.

// Evolved generators now live in defaultRuntime. These functions delegate for backward compatibility.

/** Register an evolved generator (called at startup). */
export function registerEvolvedGenerator(keyword: string, fn: (node: IRNode) => string[]): void {
  defaultRuntime.registerEvolvedGenerator(keyword, fn);
}

/** Register a target-specific evolved generator (called at startup). */
export function registerEvolvedTargetGenerator(keyword: string, target: string, fn: (node: IRNode) => string[]): void {
  defaultRuntime.registerEvolvedTargetGenerator(keyword, target, fn);
}

/** Unregister an evolved generator (for rollback/testing). */
export function unregisterEvolvedGenerator(keyword: string): void {
  defaultRuntime.unregisterEvolvedGenerator(keyword);
}

/** Clear all evolved generators (for test isolation). */
export function clearEvolvedGenerators(): void {
  defaultRuntime.clearEvolvedGenerators();
}

/** Check if an evolved generator exists for a type. */
export function hasEvolvedGenerator(type: string): boolean {
  return defaultRuntime.hasEvolvedGenerator(type);
}

// ── Shared IR node helpers ───────────────────────────────────────────────
// Implementations extracted to codegen/helpers.ts. Re-exported above.

// Internal aliases for local use within this file
const p = getProps;
const kids = getChildren;
const firstChild = getFirstChild;

// ── Type Alias ───────────────────────────────────────────────────────────
// type name=PlanState values="draft|approved|running|paused|completed|failed|cancelled"
// → export type PlanState = 'draft' | 'approved' | 'running' | ...;

export function generateType(node: IRNode): string[] {
  const { name: rawName, values, alias } = p(node) as Record<string, string>;
  const name = emitIdentifier(rawName, 'UnknownType', node);
  const exp = exportPrefix(node);

  if (values) {
    const members = values.split('|').map(v => `'${emitTemplateSafe(v.trim())}'`).join(' | ');
    return [`${exp}type ${name} = ${members};`];
  }
  if (alias) {
    return [`${exp}type ${name} = ${emitTypeAnnotation(alias, 'unknown', node)};`];
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
  const name = emitIdentifier(props.name as string, 'UnknownInterface', node);
  const ext = props.extends ? ` extends ${emitTypeAnnotation(props.extends as string, 'unknown', node)}` : '';
  const exp = exportPrefix(node);
  const lines: string[] = [];

  lines.push(`${exp}interface ${name}${ext} {`);
  for (const field of kids(node, 'field')) {
    const fp = p(field);
    const fieldName = emitIdentifier(fp.name as string, 'field', field);
    const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
    lines.push(`  ${fieldName}${opt}: ${emitTypeAnnotation(fp.type as string, 'unknown', field)};`);
  }
  lines.push('}');
  return lines;
}

// ── Discriminated Union ──────────────────────────────────────────────────
// union name=ContentSegment discriminant=type
//   variant name=prose
//     field name=text type=string
//   variant name=code
//     field name=language type=string
//     field name=code type=string
// → export type ContentSegment =
//   | { type: 'prose'; text: string }
//   | { type: 'code'; language: string; code: string };

export function generateUnion(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownUnion', node);
  const discriminant = emitIdentifier(props.discriminant as string, 'type', node);
  const exp = exportPrefix(node);
  const variants = kids(node, 'variant');

  if (variants.length === 0) {
    return [`${exp}type ${name} = never;`];
  }

  const lines: string[] = [`${exp}type ${name} =`];
  for (let i = 0; i < variants.length; i++) {
    const vp = p(variants[i]);
    const vname = emitIdentifier(vp.name as string, 'variant', variants[i]);
    const fields = kids(variants[i], 'field');
    const fieldParts = [`${discriminant}: '${emitTemplateSafe(vname)}'`];
    for (const field of fields) {
      const fp = p(field);
      const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
      fieldParts.push(`${emitIdentifier(fp.name as string, 'field', field)}${opt}: ${emitTypeAnnotation(fp.type as string, 'unknown', field)}`);
    }
    const semi = i === variants.length - 1 ? ';' : '';
    lines.push(`  | { ${fieldParts.join('; ')} }${semi}`);
  }
  return lines;
}

// ── Service (Class) ─────────────────────────────────────────────────────
// service name=TokenTracker
//   field name=entries type="TokenUsage[]" default="[]" private=true
//   method name=record params="usage:TokenUsage" returns=void
//     handler <<<
//       this.entries.push(usage);
//     >>>
//   method name=getStats returns=SessionStats
//     handler <<<
//       return { ... };
//     >>>
// singleton name=tracker type=TokenTracker
// → export class TokenTracker { ... }
// → export const tracker = new TokenTracker();

export function generateService(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownService', node);
  const impl = props.implements as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  const implClause = impl ? ` implements ${emitTypeAnnotation(impl, 'unknown', node)}` : '';
  lines.push(`${exp}class ${name}${implClause} {`);

  // Fields
  for (const field of kids(node, 'field')) {
    const fp = p(field);
    const fieldName = emitIdentifier(fp.name as string, 'field', field);
    const vis = fp.private === 'true' || fp.private === true ? 'private ' : '';
    const readonly = fp.readonly === 'true' || fp.readonly === true ? 'readonly ' : '';
    const typeAnnotation = fp.type ? `: ${emitTypeAnnotation(fp.type as string, 'unknown', field)}` : '';
    const defaultVal = fp.default as string;
    // default values are by-design raw code (escape hatch) — documented, not sanitized
    const init = defaultVal !== undefined ? ` = ${defaultVal}` : '';
    lines.push(`  ${vis}${readonly}${fieldName}${typeAnnotation}${init};`);
  }

  // Constructor (if any constructor child exists)
  const ctorNode = firstChild(node, 'constructor');
  if (ctorNode) {
    const ctorProps = p(ctorNode);
    const ctorParams = ctorProps.params ? parseParamList(ctorProps.params as string) : '';
    const ctorCode = handlerCode(ctorNode);
    lines.push('');
    lines.push(`  constructor(${ctorParams}) {`);
    if (ctorCode) {
      for (const line of ctorCode.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
  }

  // Methods
  for (const method of kids(node, 'method')) {
    const mp = p(method);
    const mname = emitIdentifier(mp.name as string, 'method', method);
    const mparams = mp.params ? parseParamList(mp.params as string) : '';
    const isAsync = mp.async === 'true' || mp.async === true;
    const isStream = mp.stream === 'true' || mp.stream === true;
    const isStatic = mp.static === 'true' || mp.static === true;
    const vis = mp.private === 'true' || mp.private === true ? 'private ' : '';
    const staticKw = isStatic ? 'static ' : '';
    const star = isStream ? '*' : '';
    const asyncKw = (isAsync || isStream) ? 'async ' : '';
    const mcode = handlerCode(method);

    // stream=true → AsyncGenerator return type
    const mreturns = isStream
      ? `: AsyncGenerator<${emitTypeAnnotation(mp.returns as string, 'unknown', method)}>`
      : mp.returns ? `: ${emitTypeAnnotation(mp.returns as string, 'unknown', method)}` : '';

    lines.push('');
    lines.push(`  ${vis}${staticKw}${asyncKw}${star}${mname}(${mparams})${mreturns} {`);
    if (mcode) {
      for (const line of mcode.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
  }

  lines.push('}');

  // Singleton instances
  for (const singleton of kids(node, 'singleton')) {
    const sp = p(singleton);
    const sname = emitIdentifier(sp.name as string, 'instance', singleton);
    const stype = emitIdentifier(sp.type as string, name, singleton);
    lines.push('');
    lines.push(`${exp}const ${sname} = new ${stype}();`);
  }

  return lines;
}

// ── Function ─────────────────────────────────────────────────────────────
// fn name=createPlan params="action:PlanAction,ws:WorkspaceSnapshot" returns=Plan
//   handler <<<
//     return { ... };
//   >>>

export function generateFunction(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'unknownFn', node);
  const params = props.params as string || '';
  const returns = props.returns as string;
  const isAsync = props.async === 'true' || props.async === true;
  const isStream = props.stream === 'true' || props.stream === true;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Parse params: "action:PlanAction,ws:WorkspaceSnapshot,spread:number=8"
  // → "action: PlanAction, ws: WorkspaceSnapshot, spread: number = 8"
  const paramList = params ? parseParamList(params) : '';

  // stream=true → async generator function
  if (isStream) {
    const yieldType = emitTypeAnnotation(returns as string, 'unknown', node);
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

  const retClause = returns ? `: ${emitTypeAnnotation(returns as string, 'unknown', node)}` : '';
  const asyncKw = isAsync ? 'async ' : '';
  const code = handlerCode(node);

  // Gap 3: signal + cleanup support for async functions
  const signalNode = firstChild(node, 'signal');
  const cleanupNode = firstChild(node, 'cleanup');
  const hasSignal = !!signalNode;
  const hasCleanup = !!cleanupNode;

  lines.push(`${exp}${asyncKw}function ${name}(${paramList})${retClause} {`);

  // Signal → AbortController setup
  if (hasSignal) {
    const signalName = emitIdentifier((p(signalNode!).name as string), 'abort', signalNode);
    lines.push(`  const ${signalName} = new AbortController();`);
  }

  // Wrap body in try/finally if cleanup exists
  if (hasCleanup) {
    lines.push('  try {');
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  } finally {');
    const cleanupCode = p(cleanupNode!).code as string || '';
    if (cleanupCode) {
      const dedented = dedent(cleanupCode);
      for (const line of dedented.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
  } else if (code) {
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
  const name = emitIdentifier(props.name as string, 'UnknownError', node);
  const ext = emitIdentifier(props.extends as string, 'Error', node);
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
      const fName = emitIdentifier(fp.name as string, 'field', field);
      const fType = emitTypeAnnotation(fp.type as string, 'unknown', field);
      if (isMessage) {
        lines.push(`    ${fName}${opt}: ${fType},`);
      } else {
        lines.push(`    public readonly ${fName}${opt}: ${fType},`);
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
// Additive: also emit a React useReducer hook wrapping the transition functions.
// Called by transpiler-ink.ts when target=ink.

export function generateMachineReducer(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownMachine', node);
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

// ── Config ───────────────────────────────────────────────────────────────
// config name=AgonConfig
//   field name=timeout type=number default=120
//   field name=approvalLevel type=ApprovalLevel default="plan"

export function generateConfig(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'Config', node);
  const exp = exportPrefix(node);
  const fields = kids(node, 'field');
  const lines: string[] = [];

  // Interface
  lines.push(`${exp}interface ${name} {`);
  for (const field of fields) {
    const fp = p(field);
    const fieldName = emitIdentifier(fp.name as string, 'field', field);
    const opt = fp.default !== undefined ? '?' : '';
    lines.push(`  ${fieldName}${opt}: ${emitTypeAnnotation(fp.type as string, 'unknown', field)};`);
  }
  lines.push('}');
  lines.push('');

  // Defaults object
  lines.push(`${exp}const DEFAULT_${name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}: Required<${name}> = {`);
  for (const field of fields) {
    const fp = p(field);
    const fieldName = emitIdentifier(fp.name as string, 'field', field);
    const ftype = emitTypeAnnotation(fp.type as string, 'unknown', field);
    let def = fp.default as string;

    if (def === undefined) {
      if (ftype === 'number') def = '0';
      else if (ftype === 'boolean') def = 'false';
      else if (ftype.endsWith('[]')) def = '[]';
      else def = "''";
    } else if (ftype === 'string' || (!['number', 'boolean'].includes(ftype) && !ftype.endsWith('[]') && !def.startsWith("'") && !def.startsWith('"'))) {
      def = emitStringLiteral(def);
    }

    lines.push(`  ${fieldName}: ${def},`);
  }
  lines.push('};');

  return lines;
}

// ── Store ────────────────────────────────────────────────────────────────
// store name=Plan path="~/.agon/plans" key=id
//   model Plan

export function generateStore(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'Store', node);
  const rawPath = props.path as string || '~/.data';
  const key = emitIdentifier(props.key as string, 'id', node);
  const model = emitIdentifier(props.model as string, 'unknown', node);
  const exp = exportPrefix(node);
  const lines: string[] = [];
  const dirConst = `${name.toUpperCase()}_DIR`;

  // Validate path before interpolation — blocks injection + traversal via storePath
  const resolvedPath = rawPath.startsWith('~/')
    ? `join(homedir(), ${emitPath(rawPath.slice(2), node)})`
    : emitPath(rawPath, node);

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
  lines.push(`  if (!sanitized) throw new Error(\`Invalid ID: \${id}\`);`);
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
  lines.push(`  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }`);
  lines.push('}');
  lines.push('');
  lines.push(`${exp}function list${name}s(limit = 20): ${model}[] {`);
  lines.push(`  ensure${name}Dir();`);
  lines.push(`  const files = readdirSync(${dirConst}).filter(f => f.endsWith('.json'));`);
  lines.push(`  const items: ${model}[] = [];`);
  lines.push(`  for (const f of files) {`);
  lines.push(`    try { items.push(JSON.parse(readFileSync(join(${dirConst}, f), 'utf-8')) as ${model}); }`);
  lines.push(`    catch { /* skip corrupt files */ }`);
  lines.push(`  }`);
  lines.push(`  return items.sort((a: any, b: any) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, limit);`);
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
  const name = emitTemplateSafe(props.name as string || 'UnknownTest');
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
    const dname = emitTemplateSafe(p(desc).name as string || 'describe');
    lines.push(`  describe('${dname}', () => {`);

    for (const test of kids(desc, 'it')) {
      const tname = emitTemplateSafe(p(test).name as string || 'test');
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
    const tname = emitTemplateSafe(p(test).name as string || 'test');
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
  const name = emitIdentifier(props.name as string, 'UnknownEvent', node);
  const exp = exportPrefix(node);
  const types = kids(node, 'type');
  const lines: string[] = [];

  // Event type union
  lines.push(`${exp}type ${name}Type = ${types.map(t => `'${emitTemplateSafe((p(t).name || p(t).value) as string)}'`).join(' | ')};`);
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
    const tname = emitTemplateSafe((tp.name || tp.value) as string);
    const data = emitTypeAnnotation(tp.data as string, 'Record<string, unknown>', t);
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
  const name = emitTemplateSafe(props.name as string || 'unknown');
  const lines: string[] = [];

  lines.push(`// ── Module: ${name} ──`);
  lines.push('');

  for (const exp of kids(node, 'export')) {
    const ep = p(exp);
    const rawFrom = ep.from as string;
    const safeFrom = rawFrom ? emitImportSpecifier(rawFrom, exp) : '';
    const rawNames = ep.names as string;
    const safeNames = rawNames ? rawNames.split(',').map(s => emitIdentifier(s.trim(), 'export', exp)).join(', ') : '';
    const rawTypeNames = ep.types as string;
    const safeTypeNames = rawTypeNames ? rawTypeNames.split(',').map(s => emitIdentifier(s.trim(), 'export', exp)).join(', ') : '';
    const star = ep.star === 'true' || ep.star === true;
    const safeDefault = ep.default ? emitIdentifier(ep.default as string, 'default', exp) : '';

    // export * from './foo.js'
    if (safeFrom && !safeNames && !safeTypeNames && star) {
      lines.push(`export * from '${safeFrom}';`);
    }
    // export { a, b } from './foo.js'
    if (safeFrom && safeNames) {
      lines.push(`export { ${safeNames} } from '${safeFrom}';`);
    }
    // export type { A, B } from './types.js'
    if (safeFrom && safeTypeNames) {
      lines.push(`export type { ${safeTypeNames} } from '${safeFrom}';`);
    }
    // export default foo
    if (safeDefault && !safeFrom) {
      lines.push(`export default ${safeDefault};`);
    }
    // export default from './foo.js' (re-export default)
    if (safeDefault && safeFrom) {
      lines.push(`export { default as ${safeDefault} } from '${safeFrom}';`);
    }
    // export { a, b } (no from — local re-export)
    if (!safeFrom && safeNames && !safeDefault) {
      lines.push(`export { ${safeNames} };`);
    }
    // export type { A, B } (no from — local type re-export)
    if (!safeFrom && safeTypeNames && !safeDefault) {
      lines.push(`export type { ${safeTypeNames} };`);
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

  const safePath = emitImportSpecifier(from, node);
  const typeKw = isTypeOnly ? 'type ' : '';
  const safeDefault = defaultImport ? emitIdentifier(defaultImport, 'default', node) : '';
  const namedList = names
    ? names.split(',').map(s => emitIdentifier(s.trim(), 'import', node)).join(', ')
    : '';

  if (safeDefault && namedList) {
    return [`import ${typeKw}${safeDefault}, { ${namedList} } from '${safePath}';`];
  }
  if (safeDefault) {
    return [`import ${typeKw}${safeDefault} from '${safePath}';`];
  }
  if (namedList) {
    return [`import ${typeKw}{ ${namedList} } from '${safePath}';`];
  }
  // Side-effect import
  return [`import '${safePath}';`];
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
  const name = emitIdentifier(props.name as string, 'unknownConst', node);
  const constType = props.type as string | undefined;
  const value = props.value as string | undefined;
  const exp = exportPrefix(node);
  const code = handlerCode(node);

  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';

  if (code) {
    return [`${exp}const ${name}${typeAnnotation} = ${code.trim()};`];
  }
  if (value) {
    return [`${exp}const ${name}${typeAnnotation} = ${value};`];
  }
  return [`${exp}const ${name}${typeAnnotation};`];
}

// ── Shared Helpers ───────────────────────────────────────────────────────
// parseParamList, capitalize, emitReasonAnnotations, emitLowConfidenceTodo
// implementations extracted to codegen/helpers.ts. Re-exported at top of file.

// ── Ground Layer: derive ─────────────────────────────────────────────────
// derive name=loudness expr={{average(stems)}} type=number deps="stems"
// → export const loudness: number = average(stems);

export function generateDerive(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const conf = p(node).confidence as string | undefined;
  const todo = emitLowConfidenceTodo(node, conf);
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'derived', node);
  // expr is by-design raw code (escape hatch)
  const expr = props.expr as string;
  const constType = props.type as string | undefined;
  const exp = exportPrefix(node);

  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';
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
  const name = emitIdentifier(props.name as string, 'transform', node);
  // target and via are by-design raw code (escape hatches)
  const target = props.target as string | undefined;
  const via = props.via as string | undefined;
  const constType = props.type as string | undefined;
  const exp = exportPrefix(node);
  const code = handlerCode(node);

  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';

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
  const name = emitIdentifier(props.name as string, 'action', node);
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
  const retClause = returns ? `: Promise<${emitTypeAnnotation(returns, 'void', node)}>` : ': Promise<void>';
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
  const name = emitIdentifier(props.name as string, 'collected', node);
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
  const name = emitIdentifier(props.name as string, 'resolver', node);
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
    const cname = emitIdentifier(cp.name as string, 'candidate', c);
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
  const name = emitIdentifier(props.name as string, 'recovery', node);
  const strategies = kids(node, 'strategy');

  const hasFallback = strategies.some(s => (p(s).name as string) === 'fallback');
  if (!hasFallback) throw new KernCodegenError('recover requires a fallback strategy', node);

  const lines: string[] = [...todo, ...annotations];
  lines.push(`/** recover: ${name} */`);
  lines.push(`async function ${name}WithRecovery<T>(fn: () => Promise<T>): Promise<T> {`);

  for (const strategy of strategies) {
    const sp = p(strategy);
    const sname = emitIdentifier(sp.name as string, 'strategy', strategy);
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

export function generateApply(node: IRNode, _depth = 0): string[] {
  // apply nodes expand the referenced pattern
  const props = p(node);
  const patternName = props.pattern as string;
  if (!patternName) return [];

  // Delegate to template expansion — propagate depth to prevent infinite recursion
  const syntheticNode: IRNode = { ...node, type: patternName };
  if (isTemplateNode(patternName)) {
    return expandTemplateNode(syntheticNode, _depth + 1);
  }
  return [`// apply: pattern '${patternName}' not found`];
}

// ── Conditional ──────────────────────────────────────────────────────────
// conditional if=isPro
//   text value="Pro features unlocked"
// → {isPro && (<>..children..</>)}

export function generateConditional(node: IRNode): string[] {
  const props = p(node);
  const rawCondition = props.if;
  // Handle expression objects: { __expr: true, code: 'loading' }
  const condition = rawCondition && typeof rawCondition === 'object' && (rawCondition as any).__expr
    ? (rawCondition as any).code as string
    : rawCondition as string;
  if (!condition) return [`// conditional: missing 'if' prop`];

  const childLines: string[] = [];
  for (const child of kids(node)) {
    childLines.push(...generateCoreNode(child));
  }

  if (childLines.length === 0) {
    return [`{${condition} && null}`];
  }
  if (childLines.length === 1) {
    return [`{${condition} && (${childLines[0].trim()})}`];
  }
  return [
    `{${condition} && (`,
    `  <>`,
    ...childLines.map(l => `    ${l}`),
    `  </>`,
    `)}`,
  ];
}

// ── Select ───────────────────────────────────────────────────────────────
// select name=status value=current placeholder="Choose"
//   option value=active label="Active"
//   option value=pending label="Pending"

export function generateSelect(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string || 'select';
  const value = props.value as string;
  const placeholder = props.placeholder as string;
  const onChange = props.onChange as string;

  const attrs: string[] = [`name="${name}"`];
  if (value) attrs.push(`value={${value}}`);
  if (onChange) attrs.push(`onChange={${onChange}}`);

  // Event handlers like onChange require 'use client' in React/Next.js
  const lines: string[] = onChange ? [`{/* kern:use-client */}`] : [];
  lines.push(`<select ${attrs.join(' ')}>`);
  if (placeholder) {
    lines.push(`  <option value="" disabled>${emitTemplateSafe(placeholder)}</option>`);
  }
  for (const opt of kids(node, 'option')) {
    const op = p(opt);
    const optValue = emitTemplateSafe(op.value as string || '');
    const optLabel = emitTemplateSafe(op.label as string || op.value as string || '');
    lines.push(`  <option value="${optValue}">${optLabel}</option>`);
  }
  lines.push(`</select>`);
  return lines;
}

// ── Model ────────────────────────────────────────────────────────────────
// model name=User table=users
//   column name=id type=uuid primary=true
//   column name=email type=string unique=true index=true
//   relation name=posts target=Post kind=one-to-many cascade=delete

export function generateModel(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownModel', node);
  const table = props.table as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Generate TypeScript interface
  lines.push(`${exp}interface ${name} {`);
  for (const col of kids(node, 'column')) {
    const cp = p(col);
    const colName = emitIdentifier(cp.name as string, 'column', col);
    const colType = mapColumnType(cp.type as string);
    const opt = cp.optional === 'true' || cp.optional === true ? '?' : '';
    lines.push(`  ${colName}${opt}: ${colType};`);
  }
  for (const rel of kids(node, 'relation')) {
    const rp = p(rel);
    const relName = emitIdentifier(rp.name as string, 'relation', rel);
    const target = rp.target as string;
    const kind = rp.kind as string || 'one-to-many';
    const relType = kind.includes('many') ? `${target}[]` : target;
    lines.push(`  ${relName}?: ${relType};`);
  }
  lines.push('}');

  // Prisma-hint comment
  if (table) {
    lines.push('');
    lines.push(`// Prisma: @@map("${table}")`);
  }

  return lines;
}

function mapColumnType(kernType: string): string {
  const typeMap: Record<string, string> = {
    uuid: 'string', string: 'string', text: 'string',
    int: 'number', integer: 'number', float: 'number', decimal: 'number',
    boolean: 'boolean', bool: 'boolean',
    date: 'Date', datetime: 'Date', timestamp: 'Date',
    json: 'Record<string, unknown>',
  };
  return typeMap[kernType] || kernType;
}

// ── Repository ───────────────────────────────────────────────────────────
// repository name=UserRepo model=User
//   method name=findByEmail params="email:string" returns="User|null"
//     handler <<<return this.findOne({ email });>>>

export function generateRepository(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownRepo', node);
  const model = props.model as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  lines.push(`${exp}class ${name} {`);
  if (model) {
    lines.push(`  constructor(private readonly model: typeof ${model}) {}`);
    lines.push('');
  }

  for (const method of kids(node, 'method')) {
    const mp = p(method);
    const mname = emitIdentifier(mp.name as string, 'method', method);
    const mparams = mp.params ? parseParamList(mp.params as string) : '';
    const isAsync = mp.async === 'true' || mp.async === true;
    const asyncKw = isAsync ? 'async ' : '';
    const mreturns = mp.returns ? `: ${emitTypeAnnotation(mp.returns as string, 'unknown', method)}` : '';
    const mcode = handlerCode(method);

    lines.push(`  ${asyncKw}${mname}(${mparams})${mreturns} {`);
    if (mcode) {
      for (const line of mcode.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
    lines.push('');
  }

  lines.push('}');
  return lines;
}

// ── Dependency ───────────────────────────────────────────────────────────
// dependency name=authService scope=singleton
//   inject name=db from=database
//   inject name=repo type=UserRepository with=db
//   returns AuthService with=repo

export function generateDependency(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'unknownDep', node);
  const scope = props.scope as string || 'transient';
  const exp = exportPrefix(node);
  const lines: string[] = [];

  const injects = kids(node, 'inject');
  const returnsNode = firstChild(node, 'returns');
  const returnsType = returnsNode ? (p(returnsNode).name || p(returnsNode).type || 'unknown') as string : 'unknown';

  if (scope === 'singleton') {
    lines.push(`let _${name}Instance: ${returnsType} | null = null;`);
    lines.push('');
  }

  lines.push(`${exp}function create${name[0].toUpperCase()}${name.slice(1)}(): ${returnsType} {`);

  if (scope === 'singleton') {
    lines.push(`  if (_${name}Instance) return _${name}Instance;`);
  }

  for (const inj of injects) {
    const ip = p(inj);
    const injName = emitIdentifier(ip.name as string, 'dep', inj);
    const injType = ip.type as string;
    const injFrom = ip.from as string;
    const injWith = ip.with as string;
    if (injFrom) {
      lines.push(`  const ${injName} = ${injFrom};`);
    } else if (injType && injWith) {
      lines.push(`  const ${injName} = new ${injType}(${injWith});`);
    } else if (injType) {
      lines.push(`  const ${injName} = new ${injType}();`);
    }
  }

  const returnsWith = returnsNode ? p(returnsNode).with as string : undefined;
  if (returnsWith) {
    lines.push(`  const instance = new ${returnsType}(${returnsWith});`);
  } else {
    lines.push(`  const instance = new ${returnsType}();`);
  }

  if (scope === 'singleton') {
    lines.push(`  _${name}Instance = instance;`);
  }

  lines.push(`  return instance;`);
  lines.push('}');

  return lines;
}

// ── Cache ────────────────────────────────────────────────────────────────
// cache name=userCache backend=redis prefix="user:" ttl=3600
//   entry name=profile key="user:{id}"
//     strategy read-through
//   invalidate on=userUpdate tags="user:{id}"

export function generateCache(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'unknownCache', node);
  const backend = props.backend as string || 'memory';
  const prefix = props.prefix as string || '';
  const ttl = props.ttl as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  lines.push(`${exp}const ${name} = {`);
  lines.push(`  prefix: '${prefix}',`);
  if (ttl) lines.push(`  ttl: ${ttl},`);
  lines.push(`  backend: '${backend}',`);
  lines.push('');

  // Entry methods
  for (const entry of kids(node, 'entry')) {
    const ep = p(entry);
    const entryName = emitIdentifier(ep.name as string, 'entry', entry);
    const key = ep.key as string || entryName;
    const strategyNode = firstChild(entry, 'strategy');
    const strategy = strategyNode ? (p(strategyNode).name as string || 'cache-aside') : 'cache-aside';

    lines.push(`  async get${entryName[0].toUpperCase()}${entryName.slice(1)}(id: string) {`);
    lines.push(`    const key = \`${prefix}${key.replace(/\{id\}/g, '${id}')}\`;`);
    if (strategy === 'read-through') {
      lines.push(`    // read-through: check cache, fetch if miss, populate cache`);
    }
    lines.push(`    return ${backend === 'redis' ? `await redis.get(key)` : `cache.get(key)`};`);
    lines.push(`  },`);
    lines.push('');
  }

  // Invalidation methods
  for (const inv of kids(node, 'invalidate')) {
    const ip = p(inv);
    const on = ip.on as string || 'update';
    const tags = ip.tags as string || '';

    lines.push(`  async invalidateOn${on[0].toUpperCase()}${on.slice(1)}(id: string) {`);
    const invalidateKey = tags
      ? `\`${prefix}${tags.replace(/\{id\}/g, '${id}')}\``
      : `\`${prefix}\${id}\``;
    lines.push(`    const key = ${invalidateKey};`);
    lines.push(`    ${backend === 'redis' ? `await redis.del(key)` : `cache.delete(key)`};`);
    lines.push(`  },`);
    lines.push('');
  }

  lines.push('} as const;');
  return lines;
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export const CORE_NODE_TYPES = new Set([
  'type', 'interface', 'field', 'fn',
  'union', 'variant',
  'service', 'method', 'singleton', 'constructor',
  'machine', 'transition',
  'error', 'module', 'export',
  'config', 'store',
  'test', 'describe', 'it',
  'event', 'import', 'const',
  'hook',
  'on', 'websocket',
  'template', 'slot', 'body',
  // Async extensions
  'signal', 'cleanup',
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
  // Backend data layer (graduated nodes)
  'model', 'column', 'relation',
  'repository',
  'dependency', 'inject',
  'cache', 'entry', 'invalidate',
  // UI controls (graduated nodes)
  'conditional',
  'select', 'option',
]);

/** Check if a node type is a core language construct. */
export function isCoreNode(type: string): boolean {
  return CORE_NODE_TYPES.has(type);
}

/** Generate TypeScript for any core language node. */
export function generateCoreNode(node: IRNode, target?: string, runtime?: KernRuntime): string[] {
  const rt = runtime ?? defaultRuntime;
  switch (node.type) {
    case 'type': return generateType(node);
    case 'interface': return generateInterface(node);
    case 'union': return generateUnion(node);
    case 'service': return generateService(node);
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
    case 'hook': return []; // Handled by @kernlang/react
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
    // Graduated nodes — backend data layer
    case 'model': return generateModel(node);
    case 'repository': return generateRepository(node);
    case 'dependency': return generateDependency(node);
    case 'cache': return generateCache(node);
    // Graduated nodes — UI controls
    case 'conditional': return generateConditional(node);
    case 'select': return generateSelect(node);
    // Structural children consumed by parents
    case 'variant': return [];
    case 'method': return [];
    case 'singleton': return [];
    case 'constructor': return [];
    case 'signal': return [];
    case 'cleanup': return [];
    case 'column': return [];
    case 'relation': return [];
    case 'inject': return [];
    case 'entry': return [];
    case 'invalidate': return [];
    case 'option': return [];
    default: {
      // Check evolved generators (v4) — target-specific first, then default
      const targetMap = target ? rt.evolvedTargetGenerators.get(node.type) : undefined;
      const targetGen = targetMap && target ? targetMap.get(target) : undefined;
      const evolvedGen = targetGen || rt.evolvedGenerators.get(node.type);
      if (evolvedGen) return evolvedGen(node);
      // Check if this is a template instance
      if (isTemplateNode(node.type, rt)) return expandTemplateNode(node, 0, rt);
      return [];
    }
  }
}
