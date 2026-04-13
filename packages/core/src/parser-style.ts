/** @internal Style block parsing for KERN nodes. */

export function splitStylePairs(block: string): string[] {
  const pairs: string[] = [];
  let current = '';
  let inQuote = false;
  let parenDepth = 0;

  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === '\\' && i + 1 < block.length) {
      current += ch + block[i + 1];
      i++;
    } else if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (!inQuote && ch === '(') {
      parenDepth++;
      current += ch;
    } else if (!inQuote && ch === ')') {
      parenDepth--;
      current += ch;
    } else if (!inQuote && parenDepth === 0 && ch === ',') {
      if (current.trim()) pairs.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) pairs.push(current.trim());
  return pairs;
}

export function parseStyleBlock(
  block: string,
  styles: Record<string, string>,
  pseudoStyles: Record<string, Record<string, string>>,
): void {
  const pairs = splitStylePairs(block);
  for (const pair of pairs) {
    // Pseudo-selector: :press:bg:#005BB5
    const pseudoMatch = pair.match(/^:([a-z]+):([A-Za-z0-9_-]+):(.+)$/);
    if (pseudoMatch) {
      const [, pseudo, key, value] = pseudoMatch;
      if (!pseudoStyles[pseudo]) pseudoStyles[pseudo] = {};
      pseudoStyles[pseudo][key] = value.trim();
      continue;
    }

    // Quoted key: "backdrop-filter":"blur(8px)"
    const quotedKeyMatch = pair.match(/^"([^"]+)"\s*:\s*(.*)/);
    if (quotedKeyMatch) {
      const key = quotedKeyMatch[1];
      let value = quotedKeyMatch[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      styles[key] = value;
      continue;
    }

    // Normal: key:value (value may be quoted)
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      const key = pair.slice(0, colonIdx).trim();
      let value = pair.slice(colonIdx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      styles[key] = value;
    }
  }
}
