/**
 * Ground Layer Generators — derive, transform, action, guard, assume, invariant,
 * collect, resolve, expect, recover, pattern, apply.
 *
 * NOTE: generateEach and generateBranch remain in codegen-core.ts because they
 * call generateCoreNode recursively (avoiding circular imports).
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import type { IRNode } from '../types.js';
import { isTemplateNode, expandTemplateNode } from '../template-engine.js';
import { KernCodegenError } from '../errors.js';
import { emitIdentifier, emitTypeAnnotation } from './emitters.js';
import { getProps, getChildren, getFirstChild, handlerCode, exportPrefix, capitalize, parseParamList, emitReasonAnnotations, emitLowConfidenceTodo } from './helpers.js';

const p = getProps;
const kids = getChildren;
const firstChild = getFirstChild;

// ── Ground Layer: derive ─────────────────────────────────────────────────

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

// ── Ground Layer: guard ──────────────────────────────────────────────────

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

// ── Ground Layer: collect ────────────────────────────────────────────────

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

// ── Ground Layer: resolve / candidate / discriminator ────────────────────

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

export function generatePattern(_node: IRNode): string[] {
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
