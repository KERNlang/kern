export function assertLambdaBinaryOperator(operator: string): void {
  if (
    operator !== '+' &&
    operator !== '-' &&
    operator !== '*' &&
    operator !== '/' &&
    operator !== '%' &&
    operator !== '==' &&
    operator !== '===' &&
    operator !== '!=' &&
    operator !== '!==' &&
    operator !== '<' &&
    operator !== '<=' &&
    operator !== '>' &&
    operator !== '>=' &&
    operator !== '&&' &&
    operator !== '||' &&
    operator !== '??'
  ) {
    throw new Error(`lambda preflight: unsupported binary operator "${operator}"`);
  }
}

export function assertLambdaUnaryOperator(operator: string): void {
  if (operator !== '!' && operator !== '-' && operator !== '+' && operator !== 'typeof' && operator !== 'void') {
    throw new Error(`lambda preflight: unsupported unary operator "${operator}"`);
  }
}
