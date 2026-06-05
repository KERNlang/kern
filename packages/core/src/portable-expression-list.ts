export function splitPortableExpressionList(raw: string, propName: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote !== null) {
      current += ch;
      if (ch === '\\' && i + 1 < raw.length) current += raw[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (depth < 0) throw new Error(`${propName} has unbalanced delimiters.`);
    if (ch === ',' && depth === 0) {
      const part = current.trim();
      if (part.length === 0) throw new Error(`${propName} contains an empty expression.`);
      out.push(part);
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote !== null || depth !== 0) throw new Error(`${propName} has unbalanced delimiters.`);
  const tail = current.trim();
  if (tail.length === 0 && raw.trim().endsWith(',')) {
    throw new Error(`${propName} contains an empty expression.`);
  }
  if (tail.length > 0) out.push(tail);
  return out;
}
