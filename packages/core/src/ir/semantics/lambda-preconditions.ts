import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const REFLECT_APPLY = Reflect.apply;
const REGEXP_TEST = RegExp.prototype.test;

export function checkLambdaPreconditions(ir: IRNode): boolean {
  if (typeof ir.props?.expr !== 'string' || ir.props.expr.trim() === '') return false;
  try {
    parseExpression(ir.props.expr);
    for (const child of ir.children ?? []) {
      if (child.type !== 'let' && child.type !== 'assign') return false;
      if (child.type === 'let' && (typeof child.props?.name !== 'string' || child.props.name === '')) return false;
      if (child.type === 'assign') {
        if (
          typeof child.props?.target !== 'string' ||
          !(REFLECT_APPLY(REGEXP_TEST, IDENTIFIER, [child.props.target]) as boolean)
        ) {
          return false;
        }
        if (child.props.value === undefined || child.props.value === '') return false;
      }
      if (child.props?.value !== undefined && child.props.value !== '') parseExpression(String(child.props.value));
    }
    return true;
  } catch {
    return false;
  }
}
