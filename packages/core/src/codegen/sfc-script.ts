export interface TypeScriptSfcScriptBlock {
  readonly content: string;
  readonly contentStart: number;
  readonly contentEnd: number;
}

/** Locate the first TypeScript script block using the same contract as stdlib injection. */
export function findTypeScriptSfcScriptBlock(code: string): TypeScriptSfcScriptBlock | null {
  const scriptOpen = /<script\b[^>]*\blang\s*=\s*["']ts["'][^>]*>/i;
  const match = code.match(scriptOpen);
  if (!match) return null;
  const tagEnd = (match.index ?? 0) + match[0].length;
  const contentStart = code[tagEnd] === '\n' ? tagEnd + 1 : tagEnd;
  const closeStart = code.indexOf('</script>', contentStart);
  const contentEnd = closeStart === -1 ? code.length : closeStart;
  return {
    content: code.slice(contentStart, contentEnd),
    contentStart,
    contentEnd,
  };
}
