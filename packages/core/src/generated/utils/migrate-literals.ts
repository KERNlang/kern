// @kern-source: migrate-literals:1
export type GapCategory = 'detected' | 'migratable' | 'blocked-by-parser' | 'blocked-by-codegen' | 'needs-new-node';

// @kern-source: migrate-literals:2
export type GapClassification = { category: GapCategory; migration?: string };

// @kern-source: migrate-literals:4
export const INLINE_SAFE_NUMBER_PATTERN = "^-?(?:0x[0-9a-fA-F][0-9a-fA-F_]*|0b[01][01_]*|0o[0-7][0-7_]*|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d[\\d_]*)?)$";

// @kern-source: migrate-literals:6
export function isInlineSafeLiteral(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) {
    return false;
  }
  if (t === 'true' || t === 'false' || t === 'null' || t === 'undefined') {
    return true;
  }
  return new RegExp(INLINE_SAFE_NUMBER_PATTERN).test(t);
}

// @kern-source: migrate-literals:15
export function isInlineSafeExpression(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) {
    return false;
  }
  if (t.includes('}}')) {
    return false;
  }
  return true;
}

// @kern-source: migrate-literals:24
export function classifyHandlerGap(parentType: string | undefined, body: string): GapClassification {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.includes('\n')) {
    return { category: 'detected' };
  }
  if (parentType === 'const' && (isInlineSafeLiteral(trimmed) || isInlineSafeExpression(trimmed))) {
    return { category: 'migratable', migration: 'literal-const' };
  }
  if (parentType === 'fn' && isInlineSafeExpression(trimmed)) {
    return { category: 'migratable', migration: 'fn-expr' };
  }
  return { category: 'detected' };
}

