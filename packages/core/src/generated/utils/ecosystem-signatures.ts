// @kern-source: ecosystem-signatures:1
export type ExternalImportRegistry = 'host' | 'npm' | 'pypi' | 'kern';

// @kern-source: ecosystem-signatures:2
export type ExternalSignatureMap = Record<string, string>;

// @kern-source: ecosystem-signatures:4
export const PYTHON_STDLIB_SIGNATURES = ({
  builtins: {
    bool: '(value?: unknown) => Promise<boolean>',
    dict: '(value?: Iterable<readonly [PropertyKey, unknown]> | Record<string, unknown>) => Promise<Record<string, unknown>>',
    float: '(value?: unknown) => Promise<number>',
    int: '(value?: unknown) => Promise<number>',
    len: '(value: unknown) => Promise<number>',
    list: '(value?: Iterable<unknown>) => Promise<unknown[]>',
    max: '(...values: number[]) => Promise<number>',
    min: '(...values: number[]) => Promise<number>',
    range: '(...args: number[]) => Promise<number[]>',
    round: '(value: number, digits?: number) => Promise<number>',
    str: '(value?: unknown) => Promise<string>',
    sum: '(values: Iterable<number>, start?: number) => Promise<number>',
  },
  json: {
    dumps: '(value: unknown, ...args: unknown[]) => Promise<string>',
    loads: '(value: string, ...args: unknown[]) => Promise<unknown>',
  },
  math: {
    acos: '(x: number) => Promise<number>',
    acosh: '(x: number) => Promise<number>',
    asin: '(x: number) => Promise<number>',
    asinh: '(x: number) => Promise<number>',
    atan: '(x: number) => Promise<number>',
    atan2: '(y: number, x: number) => Promise<number>',
    atanh: '(x: number) => Promise<number>',
    cbrt: '(x: number) => Promise<number>',
    ceil: '(x: number) => Promise<number>',
    comb: '(n: number, k: number) => Promise<number>',
    copysign: '(x: number, y: number) => Promise<number>',
    cos: '(x: number) => Promise<number>',
    cosh: '(x: number) => Promise<number>',
    degrees: '(x: number) => Promise<number>',
    dist: '(p: Iterable<number>, q: Iterable<number>) => Promise<number>',
    erf: '(x: number) => Promise<number>',
    erfc: '(x: number) => Promise<number>',
    exp: '(x: number) => Promise<number>',
    exp2: '(x: number) => Promise<number>',
    expm1: '(x: number) => Promise<number>',
    fabs: '(x: number) => Promise<number>',
    factorial: '(x: number) => Promise<number>',
    floor: '(x: number) => Promise<number>',
    fmod: '(x: number, y: number) => Promise<number>',
    frexp: '(x: number) => Promise<[number, number]>',
    fsum: '(values: Iterable<number>) => Promise<number>',
    gamma: '(x: number) => Promise<number>',
    gcd: '(...integers: number[]) => Promise<number>',
    hypot: '(...coordinates: number[]) => Promise<number>',
    isclose: '(a: number, b: number, rel_tol?: number, abs_tol?: number) => Promise<boolean>',
    isfinite: '(x: number) => Promise<boolean>',
    isinf: '(x: number) => Promise<boolean>',
    isnan: '(x: number) => Promise<boolean>',
    isqrt: '(n: number) => Promise<number>',
    lcm: '(...integers: number[]) => Promise<number>',
    ldexp: '(x: number, i: number) => Promise<number>',
    lgamma: '(x: number) => Promise<number>',
    log: '(x: number, base?: number) => Promise<number>',
    log10: '(x: number) => Promise<number>',
    log1p: '(x: number) => Promise<number>',
    log2: '(x: number) => Promise<number>',
    modf: '(x: number) => Promise<[number, number]>',
    perm: '(n: number, k?: number) => Promise<number>',
    pow: '(x: number, y: number) => Promise<number>',
    prod: '(values: Iterable<number>, start?: number) => Promise<number>',
    radians: '(x: number) => Promise<number>',
    remainder: '(x: number, y: number) => Promise<number>',
    sin: '(x: number) => Promise<number>',
    sinh: '(x: number) => Promise<number>',
    sqrt: '(x: number) => Promise<number>',
    tan: '(x: number) => Promise<number>',
    tanh: '(x: number) => Promise<number>',
    trunc: '(x: number) => Promise<number>',
  },
} as Record<string, ExternalSignatureMap>);

// @kern-source: ecosystem-signatures:82
export function parseExternalSignatureMap(value: unknown): ExternalSignatureMap | undefined {
  const isSafeSignatureName = (name: string): boolean =>
    /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/u.test(name);
  const sanitizeSignatureMap = (source: Record<string, unknown>): ExternalSignatureMap | undefined => {
    const out: ExternalSignatureMap = {};
    for (const [name, signature] of Object.entries(source)) {
      if (!isSafeSignatureName(name)) continue;
      if (typeof signature === 'string' && signature.trim().length > 0) {
        out[name] = signature.trim();
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };
  const splitCompactSignatureParts = (source: string): string[] => {
    const parts: string[] = [];
    let start = 0;
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let angleDepth = 0;
    let quote: '"' | "'" | '`' | undefined;
    let escaped = false;
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '(') parenDepth++;
      else if (char === ')' && parenDepth > 0) parenDepth--;
      else if (char === '{') braceDepth++;
      else if (char === '}' && braceDepth > 0) braceDepth--;
      else if (char === '[') bracketDepth++;
      else if (char === ']' && bracketDepth > 0) bracketDepth--;
      else if (char === '<') angleDepth++;
      else if (char === '>' && angleDepth > 0) angleDepth--;
      else if (char === ';' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0 && angleDepth === 0) {
        parts.push(source.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(source.slice(start));
    return parts;
  };
  const parseCompactSignatureMap = (source: string): ExternalSignatureMap | undefined => {
    const out: ExternalSignatureMap = {};
    for (const part of splitCompactSignatureParts(source)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const separator = trimmed.indexOf(':');
      if (separator <= 0) return undefined;
      const name = trimmed.slice(0, separator).trim();
      const signature = trimmed.slice(separator + 1).trim();
      if (!isSafeSignatureName(name) || signature.length === 0) return undefined;
      out[name] = signature;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return sanitizeSignatureMap(value as Record<string, unknown>);
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return sanitizeSignatureMap(parsed as Record<string, unknown>);
      }
    } catch {
      return undefined;
    }
  }
  return parseCompactSignatureMap(trimmed);
}

// @kern-source: ecosystem-signatures:169
export function inferExternalSignature(registry: ExternalImportRegistry, packageName: string, importedName: string): string | undefined {
  if (registry !== 'pypi') {
    return undefined;
  }
  return PYTHON_STDLIB_SIGNATURES[packageName]?.[importedName];
}

// @kern-source: ecosystem-signatures:178
export function inferExternalSignatureMap(registry: ExternalImportRegistry, packageName: string): ExternalSignatureMap | undefined {
  if (registry !== 'pypi') {
    return undefined;
  }
  const signatures = PYTHON_STDLIB_SIGNATURES[packageName];
  return signatures ? { ...signatures } : undefined;
}

// @kern-source: ecosystem-signatures:187
export function mergeExternalSignatureMaps(inferred: ExternalSignatureMap | undefined, explicit: ExternalSignatureMap | undefined): ExternalSignatureMap | undefined {
  const merged = { ...inferred ?? {}, ...explicit ?? {} };
  return (Object.keys(merged).length > 0) ? merged : undefined;
}

