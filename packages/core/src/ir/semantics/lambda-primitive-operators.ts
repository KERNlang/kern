function isNonPrimitive(value: unknown): boolean {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export function assertLambdaPrimitiveBinaryOperands(operator: string, left: unknown, right: unknown): void {
  if (isNonPrimitive(left) || isNonPrimitive(right)) {
    throw new Error(`lambda: binary operator "${operator}" does not accept non-primitive operands`);
  }
}

export function assertLambdaPrimitiveUnaryOperand(operator: string, value: unknown): void {
  if (isNonPrimitive(value)) {
    throw new Error(`lambda: unary operator "${operator}" does not accept non-primitive operands`);
  }
}
