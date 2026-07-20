import { analyzeClosurePowerRewrite } from './closure-eligibility.js';

export interface RewriteClosurePowerOptions {
  lowerExpression(source: string): string;
  validateBindingName(name: string): void;
}

/**
 * Rewrite only the outermost portable-power expressions in an accepted raw
 * closure block. All unrelated authored bytes remain untouched; each selected
 * expression is lowered through the same ValueIR emitter as ordinary native
 * body expressions.
 */
export function rewriteClosurePowerExpressions(raw: string, options: RewriteClosurePowerOptions): string {
  const plan = analyzeClosurePowerRewrite(raw);
  if (!plan) throw new Error('Internal codegen error: accepted closure block no longer parses.');
  for (const name of plan.writtenNames) options.validateBindingName(name);

  let rewritten = plan.trimmed;
  const replacements = plan.expressions.map((expression) => ({
    ...expression,
    code: options.lowerExpression(expression.source),
  }));
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    rewritten = rewritten.slice(0, replacement.start) + replacement.code + rewritten.slice(replacement.end);
  }
  return `${plan.leading}${rewritten}${plan.trailing}`;
}
