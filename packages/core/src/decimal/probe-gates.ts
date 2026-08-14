/** Zero-dependency Decimal admission policy shared by codegen and machine closures. */
export const DECIMAL_SCALE_FAILCLOSE = 'Decimal literal carries non-canonical scale/significance';
export const DECIMAL_DIV_ZERO_FAILCLOSE = 'KERN Decimal division by zero';
export const DECIMAL_MOD_ZERO_FAILCLOSE = 'KERN Decimal modulo by zero';
export const DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE =
  'Decimal.pow supports only an integer exponent on a non-negative base';
export const DECIMAL_POW_NEGATIVE_BASE_FAILCLOSE = `${DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE}: the evaluated base is negative`;
export const DECIMAL_POW_ZERO_NEGATIVE_EXP_FAILCLOSE = 'KERN Decimal 0 raised to a negative power (division by zero)';

const CANONICAL_DECIMAL_GRAMMAR = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export function isPortableDecimalLiteral(raw: string): boolean {
  if (raw.length === 0 || /[eE]/.test(raw) || !CANONICAL_DECIMAL_GRAMMAR.test(raw)) return false;
  if (raw.startsWith('-') && /^0(?:\.0+)?$/.test(raw.slice(1))) return false;
  const dot = raw.indexOf('.');
  return dot === -1 || !raw.slice(dot + 1).endsWith('0');
}

export function decimalScaleFailMessage(raw: string): string {
  return (
    `${DECIMAL_SCALE_FAILCLOSE}: Decimal("${raw}") cannot be lowered portably. ` +
    `KERN's certified Decimal subset is NUMERIC: the TS leg (decimal.js) discards ` +
    `trailing-zero / exponent / signed-zero significance (Decimal("${raw}") would ` +
    `render differently than Python's stdlib decimal, which preserves scale), so KERN ` +
    `cannot guarantee byte-exact cross-target rendering for this literal. Use a ` +
    `canonical form with no trailing zeros, no exponent, and no signed zero ` +
    `(e.g. "1.5", "0.1", "42").`
  );
}

export function assertPortableDecimalLiteral(raw: string): void {
  if (!isPortableDecimalLiteral(raw)) throw new Error(decimalScaleFailMessage(raw));
}

export function decimalPowFailMessage(reason: string): string {
  return (
    `${DECIMAL_POW_NON_INTEGER_EXP_FAILCLOSE}: ${reason}. ` +
    `KERN's certified Decimal pow is INTEGER-exponent only (0**0=1, positive, and negative int like 2**-1) ` +
    `on a non-negative base — these are byte-exact across decimal.js and Python's stdlib decimal. ` +
    `A non-integer exponent or a negative base is correctly-rounded TRANSCENDENTAL on the TS leg ` +
    `(decimal.js) and can diverge from the Python leg by ~1 ulp, so KERN cannot guarantee byte-exact ` +
    `cross-target parity and refuses it at compile time. Pass an integer-literal exponent and a ` +
    `non-negative base (e.g. Decimal.pow(Decimal.of("2"), Decimal.of("3"))). ` +
    `Fractional/transcendental pow is deferred to a later correctly-rounded slice.`
  );
}

export function decimalZeroDivisorFailMessage(op: 'div' | 'mod'): string {
  return op === 'div' ? DECIMAL_DIV_ZERO_FAILCLOSE : DECIMAL_MOD_ZERO_FAILCLOSE;
}

export interface DecimalProbeAccessor<TNode> {
  readonly callKind: string;
  receiverName(node: TNode): string | null;
  methodName(node: TNode): string | null;
  argNode(node: TNode, index: number): TNode | null;
  argKind(node: TNode): string | null;
  argLiteralValue(node: TNode): string | null;
}

export interface DecimalProbeNode {
  kind: string;
  callee?: { kind: string; object?: { kind: string; name?: string }; property?: string };
  args?: unknown[];
  value?: string;
}

export const duckDecimalProbeAccessor: DecimalProbeAccessor<DecimalProbeNode> = {
  callKind: 'call',
  receiverName(node) {
    const callee = node.callee;
    if (callee?.kind !== 'member') return null;
    return callee.object?.kind === 'ident' ? (callee.object.name ?? null) : null;
  },
  methodName(node) {
    const callee = node.callee;
    if (callee?.kind !== 'member') return null;
    return typeof callee.property === 'string' ? callee.property : null;
  },
  argNode(node, index) {
    const arg = node.args?.[index];
    return typeof arg === 'object' && arg !== null ? (arg as DecimalProbeNode) : null;
  },
  argKind(node) {
    return typeof node.kind === 'string' ? node.kind : null;
  },
  argLiteralValue(node) {
    return typeof node.value === 'string' ? node.value : null;
  },
};

export function decimalOfLiteralValue<TNode>(
  node: TNode,
  accessor: DecimalProbeAccessor<TNode> = duckDecimalProbeAccessor as unknown as DecimalProbeAccessor<TNode>,
): string | null {
  if (accessor.argKind(node) !== accessor.callKind) return null;
  if (accessor.receiverName(node) !== 'Decimal' || accessor.methodName(node) !== 'of') return null;
  const arg = accessor.argNode(node, 0);
  if (arg === null || accessor.argNode(node, 1) !== null) return null;
  if (accessor.argKind(arg) !== 'strLit') return null;
  return accessor.argLiteralValue(arg);
}

export function assertNonZeroDecimalDivisor<TNode>(
  op: string,
  divisor: TNode,
  accessor: DecimalProbeAccessor<TNode> = duckDecimalProbeAccessor as unknown as DecimalProbeAccessor<TNode>,
): void {
  if (op !== 'div' && op !== 'mod') return;
  const lit = decimalOfLiteralValue(divisor, accessor);
  if (lit === '0') {
    throw new Error(decimalZeroDivisorFailMessage(op));
  }
}

export function assertPortableDecimalPow<TNode>(
  base: TNode,
  exp: TNode,
  accessor: DecimalProbeAccessor<TNode> = duckDecimalProbeAccessor as unknown as DecimalProbeAccessor<TNode>,
): void {
  const expLit = decimalOfLiteralValue(exp, accessor);
  if (expLit === null) {
    throw new Error(
      decimalPowFailMessage(
        'the exponent must be an integer Decimal literal (e.g. Decimal.of("3")), not a variable or computed value',
      ),
    );
  }
  if (expLit.includes('.')) {
    throw new Error(decimalPowFailMessage(`the exponent Decimal.of("${expLit}") is not an integer`));
  }
  const baseLit = decimalOfLiteralValue(base, accessor);
  if (baseLit?.startsWith('-')) {
    throw new Error(decimalPowFailMessage(`the base Decimal.of("${baseLit}") is negative`));
  }
}
