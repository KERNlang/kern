const REGEX_PREFIX_WORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[$_\p{ID_Start}]/u.test(char);
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[$\u200C\u200D\p{ID_Continue}]/u.test(char);
}

function codePointAt(code: string, index: number): string | undefined {
  const point = code.codePointAt(index);
  return point === undefined ? undefined : String.fromCodePoint(point);
}

function skipQuoted(code: string, start: number, quote: '"' | "'"): number {
  let index = start + 1;
  while (index < code.length) {
    if (code[index] === '\\') index += 2;
    else if (code[index++] === quote) break;
  }
  return index;
}

function skipRegex(code: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < code.length) {
    const char = code[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      index += 1;
      while (/[A-Za-z]/u.test(code[index] ?? '')) index += 1;
      break;
    }
    index += 1;
  }
  return index;
}

interface CodeFrame {
  kind: 'code';
  braceDepth: number;
  braceExpressions: boolean[];
  interpolation: boolean;
  canStartRegex: boolean;
  parenControls: boolean[];
  pendingControlParen: boolean;
  previousToken: string | undefined;
}

interface TemplateFrame {
  kind: 'template';
}

type ScanFrame = CodeFrame | TemplateFrame;

export type EmittedCodeSourceKind = 'ts' | 'tsx';

const CONTROL_HEADER_WORDS = new Set(['catch', 'for', 'if', 'switch', 'while', 'with']);
const STATEMENT_BRACE_PREFIXES = new Set<string | undefined>([
  undefined,
  ';',
  '{',
  '}',
  ')',
  '=>',
  'do',
  'else',
  'finally',
  'try',
]);

function braceClosesExpression(frame: CodeFrame): boolean {
  return frame.canStartRegex && !STATEMENT_BRACE_PREFIXES.has(frame.previousToken);
}

function nextSignificantIndex(code: string, start: number): number {
  let index = start;
  while (index < code.length) {
    if (/\s/u.test(code[index])) {
      index += 1;
      continue;
    }
    if (code[index] === '/' && code[index + 1] === '/') {
      const newline = code.indexOf('\n', index + 2);
      index = newline < 0 ? code.length : newline + 1;
      continue;
    }
    if (code[index] === '/' && code[index + 1] === '*') {
      const end = code.indexOf('*/', index + 2);
      index = end < 0 ? code.length : end + 2;
      continue;
    }
    break;
  }
  return index;
}

/**
 * Browser-safe lexical call detector for emitted JavaScript/TypeScript.
 * TSX is conservatively fail-closed on any identifier mention because this
 * small browser-safe scanner deliberately does not implement JSX tokenization.
 */
export function emittedCodeCallsIdentifier(
  code: string,
  identifier: string,
  sourceKind: EmittedCodeSourceKind = 'ts',
): boolean {
  if (sourceKind === 'tsx') return code.includes(identifier);
  const frames: ScanFrame[] = [
    {
      kind: 'code',
      braceDepth: 0,
      braceExpressions: [],
      interpolation: false,
      canStartRegex: true,
      parenControls: [],
      pendingControlParen: false,
      previousToken: undefined,
    },
  ];
  let index = 0;
  while (index < code.length && frames.length > 0) {
    const frame = frames.at(-1) as ScanFrame;
    if (frame.kind === 'template') {
      if (code[index] === '\\') index += 2;
      else if (code[index] === '`') {
        frames.pop();
        index += 1;
      } else if (code[index] === '$' && code[index + 1] === '{') {
        frames.push({
          kind: 'code',
          braceDepth: 0,
          braceExpressions: [],
          interpolation: true,
          canStartRegex: true,
          parenControls: [],
          pendingControlParen: false,
          previousToken: undefined,
        });
        index += 2;
      } else index += 1;
      continue;
    }

    const char = code[index];
    if (frame.interpolation && char === '}' && frame.braceDepth === 0) {
      frames.pop();
      index += 1;
      continue;
    }
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && code[index + 1] === '/') {
      const newline = code.indexOf('\n', index + 2);
      index = newline < 0 ? code.length : newline + 1;
      continue;
    }
    if (char === '/' && code[index + 1] === '*') {
      const end = code.indexOf('*/', index + 2);
      index = end < 0 ? code.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      index = skipQuoted(code, index, char);
      frame.canStartRegex = false;
      frame.pendingControlParen = false;
      frame.previousToken = 'literal';
      continue;
    }
    if (char === '`') {
      frame.canStartRegex = false;
      frame.pendingControlParen = false;
      frame.previousToken = 'literal';
      frames.push({ kind: 'template' });
      index += 1;
      continue;
    }
    if (char === '/' && frame.canStartRegex) {
      index = skipRegex(code, index);
      frame.canStartRegex = false;
      frame.pendingControlParen = false;
      frame.previousToken = 'literal';
      continue;
    }
    const identifierStart = codePointAt(code, index);
    if (isIdentifierStart(identifierStart)) {
      const wordStart = index;
      index += identifierStart?.length ?? 1;
      for (let part = codePointAt(code, index); isIdentifierPart(part); part = codePointAt(code, index)) {
        index += part?.length ?? 1;
      }
      const word = code.slice(wordStart, index);
      const propertyAccess = frame.previousToken === '.';
      const next = nextSignificantIndex(code, index);
      if (word === identifier && !propertyAccess && frame.previousToken !== 'function' && code[next] === '(') {
        return true;
      }
      frame.canStartRegex = !propertyAccess && REGEX_PREFIX_WORDS.has(word);
      frame.pendingControlParen = !propertyAccess && CONTROL_HEADER_WORDS.has(word);
      frame.previousToken = word;
      continue;
    }
    if (/[0-9]/u.test(char)) {
      index += 1;
      while (/[0-9A-Za-z_.]/u.test(code[index] ?? '')) index += 1;
      frame.canStartRegex = false;
      frame.pendingControlParen = false;
      frame.previousToken = 'number';
      continue;
    }
    if (char === '=' && code[index + 1] === '>') {
      frame.canStartRegex = true;
      frame.pendingControlParen = false;
      frame.previousToken = '=>';
      index += 2;
      continue;
    }
    if (char === '{') {
      frame.braceExpressions.push(braceClosesExpression(frame));
      frame.braceDepth += 1;
      frame.canStartRegex = true;
    } else if (char === '}') {
      frame.braceDepth = Math.max(0, frame.braceDepth - 1);
      frame.canStartRegex = !(frame.braceExpressions.pop() ?? false);
    } else if (char === '(') {
      frame.parenControls.push(frame.pendingControlParen);
      frame.canStartRegex = true;
    } else if (char === ')') {
      frame.canStartRegex = frame.parenControls.pop() ?? false;
    } else if (char === ']') {
      frame.canStartRegex = false;
    } else if (char === '+' && code[index + 1] === '+') {
      index += 1;
      frame.canStartRegex = false;
    } else if (char === '-' && code[index + 1] === '-') {
      index += 1;
      frame.canStartRegex = false;
    } else {
      frame.canStartRegex = char !== '.';
    }
    frame.pendingControlParen = false;
    frame.previousToken = char;
    index += 1;
  }

  return false;
}
