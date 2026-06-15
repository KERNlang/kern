// @kern-source: migrate-literals:1
export type GapCategory = 'detected' | 'migratable' | 'blocked-by-parser' | 'blocked-by-codegen' | 'needs-new-node';

// @kern-source: migrate-literals:2
export type GapClassification = { category: GapCategory; migration?: string };

// @kern-source: migrate-literals:4
export function isInlineSafeLiteral(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) {
    return false;
  }
  if (t === 'true' || t === 'false' || t === 'null' || t === 'undefined') {
    return true;
  }
  return /^-?(?:0x[0-9a-fA-F][0-9a-fA-F_]*|0b[01][01_]*|0o[0-7][0-7_]*|[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9][0-9_]*)?)$/.test(t);
}

// @kern-source: migrate-literals:13
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

// @kern-source: migrate-literals:22
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

