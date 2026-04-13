/** @internal Token stream cursor for KERN parser. */
import type { Token } from './parser-tokenizer.js';

export class TokenStream {
  private tokens: Token[];
  private idx = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token | undefined {
    return this.tokens[this.idx];
  }
  next(): Token | undefined {
    return this.tokens[this.idx++];
  }
  done(): boolean {
    return this.idx >= this.tokens.length;
  }
  position(): number {
    return this.idx;
  }
  setPosition(pos: number): void {
    this.idx = pos;
  }

  skipWS(): void {
    while (this.idx < this.tokens.length && this.tokens[this.idx].kind === 'whitespace') this.idx++;
  }

  /** Try to consume an identifier. Returns its value or null. */
  tryIdent(): string | null {
    if (this.idx < this.tokens.length && this.tokens[this.idx].kind === 'identifier') {
      return this.tokens[this.idx++].value;
    }
    return null;
  }

  /** Try to consume a number token. Returns its value or null. */
  tryNumber(): string | null {
    if (this.idx < this.tokens.length && this.tokens[this.idx].kind === 'number') {
      return this.tokens[this.idx++].value;
    }
    return null;
  }

  /** Check if the next non-WS token is an identifier followed by '='. */
  isKeyValue(): boolean {
    let j = this.idx;
    while (j < this.tokens.length && this.tokens[j].kind === 'whitespace') j++;
    if (j >= this.tokens.length || this.tokens[j].kind !== 'identifier') return false;
    return j + 1 < this.tokens.length && this.tokens[j + 1].kind === 'equals';
  }

  /** Check if any remaining token contains '='. */
  hasEquals(): boolean {
    for (let j = this.idx; j < this.tokens.length; j++) {
      if (this.tokens[j].kind === 'equals') return true;
    }
    return false;
  }

  /** Check if there are more non-whitespace tokens. */
  hasMore(): boolean {
    let j = this.idx;
    while (j < this.tokens.length && this.tokens[j].kind === 'whitespace') j++;
    return j < this.tokens.length;
  }

  /** Get remaining raw text from current position (for fallback / params). */
  remainingRaw(line: string): string {
    if (this.idx >= this.tokens.length) return '';
    const startPos = this.tokens[this.idx].pos;
    this.idx = this.tokens.length;
    return line.slice(startPos);
  }

  /** Consume any single non-whitespace token as a value (for evolved positional args). */
  consumeAnyValue(): Token | undefined {
    this.skipWS();
    const tok = this.peek();
    if (!tok || tok.kind === 'whitespace') return undefined;
    return this.next();
  }
}
