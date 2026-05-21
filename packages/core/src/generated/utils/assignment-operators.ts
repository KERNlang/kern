// @kern-source: assignment-operators:1
export type SupportedAssignOperator = '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' | '&=' | '|=' | '^=' | '<<=' | '>>=' | '++' | '--';

// @kern-source: assignment-operators:2
export type PostfixMutationOperator = '++' | '--';

// @kern-source: assignment-operators:4
export const SUPPORTED_ASSIGN_OPERATORS = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=', '++', '--'];

// @kern-source: assignment-operators:6
export function isSupportedAssignOperator(op: string): boolean {
  return SUPPORTED_ASSIGN_OPERATORS.includes(op);
}

// @kern-source: assignment-operators:10
export function isPostfixMutationOperator(op: string): boolean {
  return op === '++' || op === '--';
}

